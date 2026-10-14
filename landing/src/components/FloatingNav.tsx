import { useEffect, useState } from "react";
import { AnimatePresence, LayoutGroup, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Heart, Menu, Star, X, Github } from "lucide-react";
import { Button } from "./arc/button/button";

const navigation = [
  { id: "home", title: "Home", href: "#home" },
  { id: "features", title: "Features", href: "#features" },
  { id: "how-it-works", title: "How it works", href: "#how-it-works" },
] as const;

export default function FloatingNav({ sponsorUrl }: { sponsorUrl?: string }) {
  const [active, setActive] = useState<string>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSponsorMessage, setShowSponsorMessage] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(item => item.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0, 0.2, 0.5] }
    );
    navigation.forEach(item => {
      const section = document.getElementById(item.id);
      if (section) observer.observe(section);
    });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!showSponsorMessage) return;
    const onEsc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowSponsorMessage(false);
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [showSponsorMessage]);

  const navLinks = navigation.map(item => (
    <a
      key={item.id}
      className="capsule-link"
      href={item.href}
      aria-current={active === item.id ? "location" : undefined}
      onClick={() => { setActive(item.id); setMenuOpen(false); }}
    >
      {active === item.id && <motion.span layoutId="active-nav" className="capsule-active" transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 360, damping: 32 }} aria-hidden="true" />}
      <span>{item.title}</span>
    </a>
  ));

  return <>
    <div className="floating-nav-shell">
      <nav className="floating-capsule" aria-label="Primary navigation">
        <a className="brand" href="#home" aria-label="NOX, home" onClick={() => setActive("home")}>
          <img src="/nox.png" width={31} height={31} alt="" />
          <span>nox<span className="brand-dot">.</span></span>
        </a>
        <div className="nav-divider" aria-hidden="true" />
        <LayoutGroup id="site-navigation"><div className="capsule-links">{navLinks}</div></LayoutGroup>
        <div className="nav-divider cta-divider" aria-hidden="true" />
        <div className="capsule-actions">
          <a className="capsule-github" href="https://github.com/howlil/nox" target="_blank" rel="noopener noreferrer" aria-label="Star NOX on GitHub (opens in a new tab)">
            <Star aria-hidden="true" size={15} />
            <span className="github-label">Star on GitHub</span>
            <ArrowUpRight className="github-external" aria-hidden="true" size={13} />
          </a>
          {sponsorUrl ? (
            <a className="capsule-sponsor" href={sponsorUrl} target="_blank" rel="noopener noreferrer"><Heart size={15} aria-hidden="true" /> <span>Sponsor</span></a>
          ) : (
            <Button className="capsule-sponsor" variant="primary" size="sm" onClick={() => setShowSponsorMessage(true)}>
              <Heart size={15} aria-hidden="true" /> <span>Sponsor</span>
            </Button>
          )}
          <button type="button" className="capsule-menu-toggle" aria-expanded={menuOpen} aria-controls="mobile-nox-menu" aria-label={menuOpen ? "Close menu" : "Open menu"} onClick={() => setMenuOpen(!menuOpen)}>
            {menuOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {menuOpen && <motion.div id="mobile-nox-menu" className="mobile-nav-panel" initial={reducedMotion ? false : { opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -6 }} transition={{ duration: 0.22 }}>
          {navigation.map(item => <a href={item.href} key={item.id} onClick={() => { setActive(item.id); setMenuOpen(false); }}>{item.title}</a>)}
          <a href="https://github.com/howlil/nox" target="_blank" rel="noopener noreferrer"><Github size={16} /> Source code</a>
        </motion.div>}
      </AnimatePresence>
    </div>
    <AnimatePresence>
      {showSponsorMessage && <motion.div className="dialog-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowSponsorMessage(false)}>
        <motion.section role="dialog" aria-modal="true" aria-labelledby="sponsor-dialog-title" className="sponsor-dialog" initial={reducedMotion ? false : { opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.22 }} onClick={event => event.stopPropagation()}>
          <div className="sponsor-dialog-header"><Heart size={18} /><button autoFocus type="button" aria-label="Close sponsor information" onClick={() => setShowSponsorMessage(false)}><X size={18} /></button></div>
          <h2 id="sponsor-dialog-title">Support NOX</h2>
          <p>A verified sponsorship page is not configured yet. You can support the project by starring it on GitHub.</p>
          <a className="dialog-action" href="https://github.com/howlil/nox" target="_blank" rel="noopener noreferrer"><Star size={16} /> Visit GitHub <ArrowUpRight size={14} /></a>
        </motion.section>
      </motion.div>}
    </AnimatePresence>
  </>;
}