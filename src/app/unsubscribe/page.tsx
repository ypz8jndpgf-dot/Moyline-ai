export default function UnsubscribePage({
  searchParams,
}: {
  searchParams: { error?: string };
}) {
  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center">
      <h1 className="font-display text-3xl mb-4">
        <span className="gold-text">UNSUBSCRIBE</span>
      </h1>
      {searchParams.error === "invalid" ? (
        <p className="text-muted text-sm">
          That unsubscribe link isn&apos;t valid. Links are unique to each email address —
          please use the link from the bottom of a recent email.
        </p>
      ) : (
        <>
          <p className="text-muted text-sm mb-6">
            Use the unsubscribe link at the bottom of any MoyLine AI email to opt out of
            daily briefs and daily result emails in one click.
          </p>
          <a href="/" className="btn-gold px-8 py-3 inline-block">
            Back to MoyLine AI
          </a>
        </>
      )}
    </div>
  );
}
