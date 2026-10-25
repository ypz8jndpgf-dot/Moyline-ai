import { getTrackRecord } from "@/lib/store";
import { getRecordAnalytics } from "@/lib/records";
import { clvMovementsForPicks } from "@/lib/clv";
import RecordTabs from "./record-tabs";

export const dynamic = "force-dynamic";

export default async function TrackRecordPage() {
  const [rec, analytics] = await Promise.all([
    getTrackRecord(),
    getRecordAnalytics(),
  ]);
  const clvByPick = await clvMovementsForPicks(rec.picks);
  return <RecordTabs rec={rec} analytics={analytics} clvByPick={clvByPick} />;
}
