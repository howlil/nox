import { useEffect, useState } from "react";
import { ArrowUpRight, Heart, Star } from "lucide-react";

/** Flat transparent header at the top, floating glass capsule after 72px, as in Modu. */
export default function FloatingNav({ sponsorUrl }: { sponsorUrl?: string }) {
  const [scrolled, setScrolled] = useState(false);
  const sponsorHref = sponsorUrl || "https://github.com/sponsors/howlil";

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > 72);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, []);

  return (
    <div className={`floating-nav-shell${scrolled ? " is-scrolled" : ""}`}>
      <nav className="floating-capsule" aria-label="NOX">
        <a className="brand" href="#home" aria-label="NOX home">
          <img className="brand-mark" src="/nox.svg" width={33} height={33} alt="" aria-hidden="true" />
          <span>nox<span className="brand-dot">.</span></span>
        </a>
        <div className="capsule-actions">
          <a
            className="capsule-github"
            href="https://github.com/howlil/nox"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Star NOX on GitHub (opens in a new tab)"
          >
            <Star size={15} aria-hidden="true" />
            <span className="github-label">Star on GitHub</span>
            <span className="github-label-short">Star</span>
            <ArrowUpRight className="github-external" size={14} aria-hidden="true" />
          </a>
          <a
            className="capsule-sponsor"
            href={sponsorHref}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Sponsor NOX on GitHub (opens in a new tab)"
          >
            <Heart size={15} aria-hidden="true" />
            <span>Sponsor</span>
          </a>
        </div>
      </nav>
    </div>
  );
}
