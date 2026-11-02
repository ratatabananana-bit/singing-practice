package app.singingpractice;

import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.yausername.ffmpeg.FFmpeg;
import com.yausername.youtubedl_android.YoutubeDL;
import com.yausername.youtubedl_android.YoutubeDLRequest;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import kotlin.Unit;

/**
 * On-device YouTube audio fetch: yt-dlp (with its QuickJS runtime) + ffmpeg bundled in the APK via
 * youtubedl-android, the same library YTDLnis uses. No PC helper needed.
 *
 * The bundled yt-dlp goes stale within weeks (YouTube changes constantly; a stale build fails with
 * "HTTP Error 403"). No background updating: when a download fails, the plugin pulls the latest
 * stable yt-dlp release and retries once before giving up. Settings also has a manual Update button.
 *
 * download({url}) resolves {path, title, ext}; the web side reads the file through Capacitor's file URL.
 */
@CapacitorPlugin(name = "YtAudio")
public class YtAudioPlugin extends Plugin {
    private static final String TAG = "YtAudio";
    private static final String PROCESS_ID = "yt-audio";
    private final ExecutorService exec = Executors.newSingleThreadExecutor();
    private volatile boolean ready = false;
    private volatile String initError = null;

    @Override
    public void load() {
        // First run unpacks the Python runtime (a few seconds); do it in the background so the
        // first download does not pay for it.
        exec.submit(this::ensureInit);
    }

    private synchronized void ensureInit() {
        if (ready) return;
        try {
            YoutubeDL.getInstance().init(getContext());
            FFmpeg.getInstance().init(getContext());
            ready = true;
            initError = null;
        } catch (Exception e) {
            initError = e.getMessage() == null ? e.toString() : e.getMessage();
            Log.e(TAG, "init failed", e);
        }
    }

    /** Update yt-dlp from the stable release channel. Returns the status name, or null on failure. */
    private String updateYtDlp() {
        try {
            YoutubeDL.UpdateStatus st = YoutubeDL.getInstance().updateYoutubeDL(getContext(), YoutubeDL.UpdateChannel.STABLE.INSTANCE);
            Log.i(TAG, "yt-dlp update: " + st + " → " + YoutubeDL.getInstance().version(getContext()));
            return st == null ? "unknown" : st.name();
        } catch (Exception e) {
            Log.w(TAG, "yt-dlp update failed: " + e.getMessage());
            return null;
        }
    }

    @PluginMethod
    public void download(PluginCall call) {
        final String url = call.getString("url", "");
        if (url == null || url.trim().isEmpty()) {
            call.reject("No URL");
            return;
        }
        exec.submit(() -> {
            ensureInit();
            if (!ready) {
                call.reject("yt-dlp could not start: " + initError);
                return;
            }
            try {
                JSObject ret = runDownload(url.trim());
                call.resolve(ret);
            } catch (YoutubeDL.CanceledException e) {
                call.reject("Cancelled");
            } catch (Exception first) {
                // Most failures are a stale yt-dlp: update and try once more.
                Log.w(TAG, "download failed, updating yt-dlp and retrying: " + summarize(first));
                notifyProgress(0, 0, "Updating yt-dlp…");
                if (updateYtDlp() == null) {
                    call.reject(summarize(first));
                    return;
                }
                try {
                    call.resolve(runDownload(url.trim()));
                } catch (YoutubeDL.CanceledException e) {
                    call.reject("Cancelled");
                } catch (Exception second) {
                    Log.e(TAG, "download failed after update", second);
                    call.reject(summarize(second));
                }
            }
        });
    }

    private JSObject runDownload(String url) throws Exception {
        File dir = new File(getContext().getCacheDir(), "yt-audio");
        deleteRecursive(dir);
        if (!dir.mkdirs()) throw new Exception("Could not create a cache folder");
        YoutubeDLRequest req = new YoutubeDLRequest(url);
        req.addOption("--no-playlist");
        req.addOption("--no-update");
        req.addOption("-f", "bestaudio/best");
        req.addOption("-x");
        req.addOption("--audio-format", "mp3");
        req.addOption("--audio-quality", "2");
        // Fixed rate + stereo so decodeAudioData in the WebView never has to resample.
        req.addOption("--postprocessor-args", "ffmpeg:-ar 44100 -ac 2");
        req.addOption("--no-mtime");
        req.addOption("-o", new File(dir, "%(title)s.%(ext)s").getAbsolutePath());
        YoutubeDL.getInstance().execute(req, PROCESS_ID, (progress, eta, line) -> {
            notifyProgress(progress, eta, line);
            return Unit.INSTANCE;
        });
        File[] files = dir.listFiles();
        File out = null;
        if (files != null) {
            for (File f : files) {
                if (f.isFile() && (out == null || f.length() > out.length())) out = f;
            }
        }
        if (out == null) throw new Exception("yt-dlp produced no file");
        String name = out.getName();
        int dot = name.lastIndexOf('.');
        String title = dot > 0 ? name.substring(0, dot) : name;
        String ext = dot > 0 ? name.substring(dot + 1) : "mp3";
        JSObject ret = new JSObject();
        ret.put("path", out.getAbsolutePath());
        ret.put("title", title);
        ret.put("ext", ext);
        ret.put("bytes", out.length());
        return ret;
    }

    private void notifyProgress(float percent, long eta, String line) {
        JSObject ev = new JSObject();
        ev.put("percent", percent);
        ev.put("eta", eta);
        ev.put("line", line);
        notifyListeners("progress", ev);
    }

    /** yt-dlp prints warnings before the error; keep only the ERROR lines (or the last two lines). */
    private static String summarize(Exception e) {
        String msg = e.getMessage() == null ? e.toString() : e.getMessage();
        String[] lines = msg.trim().split("\n");
        List<String> errors = new ArrayList<>();
        for (String l : lines) {
            String t = l.trim();
            if (t.startsWith("ERROR:")) errors.add(t.substring(6).trim());
        }
        if (!errors.isEmpty()) return String.join(" · ", errors);
        StringBuilder sb = new StringBuilder();
        for (int i = Math.max(0, lines.length - 2); i < lines.length; i++) {
            if (sb.length() > 0) sb.append(' ');
            sb.append(lines[i].trim());
        }
        return sb.length() > 0 ? sb.toString() : "download failed";
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        boolean killed = YoutubeDL.getInstance().destroyProcessById(PROCESS_ID);
        JSObject ret = new JSObject();
        ret.put("cancelled", killed);
        call.resolve(ret);
    }

    /** Update the bundled yt-dlp to the latest stable release now (needs internet). */
    @PluginMethod
    public void update(PluginCall call) {
        exec.submit(() -> {
            ensureInit();
            if (!ready) {
                call.reject("yt-dlp could not start: " + initError);
                return;
            }
            String st = updateYtDlp();
            if (st == null) {
                call.reject("Update failed (offline, or GitHub unreachable)");
                return;
            }
            JSObject ret = new JSObject();
            ret.put("status", st);
            ret.put("version", YoutubeDL.getInstance().version(getContext()));
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void version(PluginCall call) {
        exec.submit(() -> {
            ensureInit();
            JSObject ret = new JSObject();
            ret.put("ready", ready);
            ret.put("error", initError);
            ret.put("version", ready ? YoutubeDL.getInstance().version(getContext()) : null);
            call.resolve(ret);
        });
    }

    private static void deleteRecursive(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRecursive(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
