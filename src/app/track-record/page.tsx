import { getTrackRecord } from "@/lib/store";
import { getRecordAnalytics } from "@/lib/records";
import RecordTabs from "./record-tabs";

export const dynamic = "force-dynamic";

export default async function TrackRecordPage() {
  const [rec, analytics] = await Promise.all([
    getTrackRecord(),
    getRecordAnalytics(),
  ]);
  return <RecordTabs rec={rec} analytics={analytics} />;
}
