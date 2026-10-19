import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BookOpenText, BrainCircuit, CheckCircle2, Lightbulb, RotateCcw } from "lucide-react";
import SegmentedControl from "./arc/segmented-control/segmented-control";

const actions = [
  { value: "explain", label: "Explain" },
  { value: "practice", label: "Practice" },
  { value: "review", label: "Review" },
];

export default function LearningDemo() {
  const [action, setAction] = useState("practice");
  const [answer, setAnswer] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const reduced = useReducedMotion();
  const switchAction = (next: string) => { setAction(next); setSubmitted(false); setAnswer(null); };
  return <div className="demo-window">
    <div className="demo-windowbar"><div className="traffic-lights" aria-hidden="true"><i/><i/><i/></div><span>NOX · Interactive preview</span><span className="demo-windowbar-end">OBSIDIAN</span></div>
    <div className="demo-columns">
      <div className="demo-note">
        <div className="demo-path">Knowledge Base / Networking</div>
        <h3>TCP Fundamentals</h3>
        <p>TCP adjusts the amount of data it sends to match the network's available capacity.</p>
        <div className="demo-highlight">During slow start, the congestion window grows as acknowledgments arrive.</div>
        <div className="demo-faux-line"/><div className="demo-faux-line short"/>
      </div>
      <div className="demo-chat">
        <div className="demo-chat-heading"><img src="/nox.svg" width={24} height={24} alt="" /><strong>NOX</strong><span>@ TCP Fundamentals.md</span></div>
        <SegmentedControl label="Choose learning action" options={actions} value={action} onValueChange={switchAction} className="demo-segments"/>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={action} className="demo-answer" initial={reduced ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8 }} transition={{ duration: 0.24 }}>
            {action === "explain" && <>
              <div className="demo-eyebrow"><Lightbulb size={14}/> EXPLAIN</div>
              <h4>What is slow start?</h4>
              <p>TCP begins cautiously, then increases the amount of unacknowledged data it sends as the network successfully delivers packets.</p>
              <div className="demo-insight"><BookOpenText size={16}/><span>Think of it as gradually testing how much traffic the network can handle.</span></div>
            </>}
            {action === "practice" && <>
              <div className="demo-eyebrow"><BrainCircuit size={14}/> PRACTICE</div>
              <h4>What does the congestion window control?</h4>
              <div role="radiogroup" aria-label="TCP question choices" className="demo-options">
                {[["a","The DNS lookup speed"],["b","The amount of data in flight"],["c","The encryption algorithm"]].map(([id, label]) =>
                  <label key={id} className={"demo-option " + (answer === id ? "is-selected" : "")}>
                    <input type="radio" name="demo-tcp" value={id} checked={answer === id} disabled={submitted} onChange={() => setAnswer(id)} />
                    <span>{id.toUpperCase()}</span>{label}
                  </label>)}
              </div>
              {submitted ? <div role="status" className={"demo-feedback " + (answer === "b" ? "is-correct" : "")}>{answer === "b" ? "Correct — the congestion window bounds in-flight data." : "Not quite. Review what the congestion window measures."} <button type="button" onClick={() => { setSubmitted(false); setAnswer(null); }}>Try again</button></div>
                : <button type="button" className="demo-submit" disabled={!answer} onClick={() => setSubmitted(true)}>Check answer <CheckCircle2 size={15}/></button>}
            </>}
            {action === "review" && <>
              <div className="demo-eyebrow"><RotateCcw size={14}/> REVIEW</div>
              <h4>Make the connection</h4>
              <p>Review how acknowledgments affect the congestion window before moving to congestion avoidance.</p>
              <div className="demo-insight"><BookOpenText size={16}/><span>Focus: ACKs → congestion window → sending rate.</span></div>
            </>}
          </motion.div>
        </AnimatePresence>
        <p className="demo-disclaimer">Illustrative example · not connected to your vault</p>
      </div>
    </div>
  </div>;
}