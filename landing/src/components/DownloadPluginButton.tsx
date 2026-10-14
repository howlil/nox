import { ActionButton } from "./arc/action-button/action-button";

/**
 * GitHub Releases is the public distribution destination.
 * Opening Releases does not prove that an installable asset exists or has downloaded.
 */
const releasesUrl = "https://github.com/howlil/nox/releases";

export default function DownloadPluginButton({ className = "" }: { className?: string }) {
  const openReleases = () => {
    // A synchronous gesture keeps popup blockers from treating this as an async launch.
    const tab = window.open(releasesUrl, "_blank");
    if (tab) {
      tab.opener = null;
    } else {
      // Still provide a working route when popups are blocked.
      window.location.assign(releasesUrl);
    }
  };

  return (
    <ActionButton
      className={`download-action ${className}`.trim()}
      label="Download plugin"
      pendingLabel="Opening..."
      successLabel="Releases opened"
      resetAfterMs={1800}
      onAction={openReleases}
      title="View NOX plugin releases on GitHub"
    />
  );
}
