import { useEffect, useState } from "react";
import DownloadPluginButton from "./DownloadPluginButton";

/** Flat transparent header at the top, floating glass capsule after 72px, as in Modu. */
export default function FloatingNav() {
  const [scrolled, setScrolled] = useState(false);

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
          <svg className="brand-mark" viewBox="100 230 1160 1024" width={33} height={33} aria-hidden="true" focusable="false">
                      <defs>
                        <linearGradient id="nox-nav-hood" x1=".12" y1=".12" x2=".87" y2=".96">
                          <stop stopColor="#fff8ff" /><stop offset=".34" stopColor="#dcc1ff" />
                          <stop offset=".78" stopColor="#a979ee" /><stop offset="1" stopColor="#ccb0fc" />
                        </linearGradient>
                        <linearGradient id="nox-nav-face" x1="0" y1="0" x2="1" y2="1">
                          <stop stopColor="#1b1036" /><stop offset="1" stopColor="#321a54" />
                        </linearGradient>
                        <linearGradient id="nox-nav-eye" x1="0" y1="0" x2=".7" y2="1">
                          <stop stopColor="#fffefa" /><stop offset="1" stopColor="#efebff" />
                        </linearGradient>
                      </defs>
                      <path d="M929 261C866 253 757 284 676 343 593 402 551 471 548 549 546 624 511 662 439 713 328 789 214 890 168 1000 127 1092 140 1189 178 1254H1164C1259 1142 1279 1034 1233 904 1192 786 1104 695 999 614 897 532 839 486 842 417 844 366 877 323 935 270 941 263 937 260 929 261Z" fill="url(#nox-nav-hood)" />
                      <path d="M935 262C767 302 666 400 630 541 612 666 526 726 412 793 290 864 225 1037 287 1254H181C130 1164 129 1073 168 1000 226 883 329 791 440 715 510 665 547 625 548 549 551 470 593 402 676 343 764 286 874 258 935 262Z" fill="#fff" opacity=".38" />
                      <path d="M740 572C759 604 762 633 760 669 758 734 701 788 624 843 516 918 432 974 419 1029 406 1083 446 1142 515 1196 547 1221 576 1242 595 1254H854C928 1206 1008 1144 1041 1071 1087 964 999 805 896 695 838 633 783 589 740 572Z" fill="url(#nox-nav-face)" />
                      <ellipse cx="652" cy="1037" rx="54" ry="99" transform="rotate(-10 652 1037)" fill="url(#nox-nav-eye)" />
                      <ellipse cx="866" cy="985" rx="54" ry="100" transform="rotate(-10 866 985)" fill="url(#nox-nav-eye)" />
                    </svg>
          <span>nox<span className="brand-dot">.</span></span>
        </a>
        <div className="capsule-actions">
          <DownloadPluginButton />
        </div>
      </nav>
    </div>
  );
}
