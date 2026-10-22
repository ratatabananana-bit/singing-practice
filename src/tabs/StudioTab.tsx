import { TrackCard } from './studio/TrackCard';
import { MasterCard } from './studio/MasterCard';
import { TakesList } from './studio/TakesList';

export function StudioTab() {
  return (
    <div className="cols">
      <div className="col">
        <TrackCard />
      </div>
      <div className="col">
        <MasterCard />
        <TakesList />
      </div>
    </div>
  );
}
