import { motion, useReducedMotion } from "motion/react";

export default function MascotMotion() {
  const reduced = useReducedMotion();
  return <motion.img
    className="hero-mascot"
    src="/nox-mascot.svg"
    width="760"
    height="760"
    alt="NOX purple ghost mascot"
    decoding="async"
    initial={reduced ? false : { opacity: 0, y: 38 }}
    animate={reduced ? { opacity: 1 } : { opacity: 1, y: [0, -13, 0] }}
    transition={reduced ? { duration: 0 } : { opacity: { duration: 0.8, delay: 0.18 }, y: { duration: 9, repeat: Infinity, ease: "easeInOut", delay: 0.8 } }}
  />;
}