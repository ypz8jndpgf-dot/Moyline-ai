import { getTrackRecord } from "@/lib/store";
import RecordTabs from "./record-tabs";

export const dynamic = "force-dynamic";

export default async function TrackRecordPage() {
  const rec = await getTrackRecord();
  return <RecordTabs rec={rec} />;
}
