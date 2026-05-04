/* global React, Wordmark, CTAButton, Frame, halftoneBg, gridBg */

// =========================================================================
// DID YOU KNOW TEMPLATE
// Composition: eyebrow "Did you know?" + a fact statement + supporting body + CTA
// =========================================================================
const DYKPost = ({
  theme = "light",
  fact = "The average person interviews only one real estate agent before hiring them — yet the right agent can save you tens of thousands.",
  body = "Top agents negotiate harder, price smarter, and know which contingencies to fight for. Choosing well is the highest-leverage decision you'll make.",
  number = "01",
}) => {

  const eyebrow = "Did you know?";

  if (theme === "light") {
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#999" }}>FACT / {number}</div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 32 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#000", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 700, fontSize: 36, lineHeight: 1 }}>?</div>
              <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 36, letterSpacing: "-0.02em", lineHeight: 1 }}>{eyebrow}</div>
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 700, fontSize: 84, letterSpacing: "-0.035em", lineHeight: 1.0, textWrap: "balance" }}>
              {fact}
            </div>
            <div style={{ width: 80, height: 3, background: "#000", margin: "48px 0 32px" }}/>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 400, fontSize: 32, letterSpacing: "-0.01em", lineHeight: 1.4, color: "#444", maxWidth: 880, textWrap: "pretty" }}>
              {body}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#999", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "inverse") {
    return (
      <Frame bg="#000" color="#fff">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark color="#fff" size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666" }}>FACT / {number}</div>
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 32 }}>
              <div style={{ width: 56, height: 56, borderRadius: "50%", background: "#fff", color: "#000", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 700, fontSize: 36, lineHeight: 1 }}>?</div>
              <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 36, letterSpacing: "-0.02em", lineHeight: 1 }}>{eyebrow}</div>
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 700, fontSize: 84, letterSpacing: "-0.035em", lineHeight: 1.0, textWrap: "balance" }}>
              {fact}
            </div>
            <div style={{ width: 80, height: 3, background: "#fff", margin: "48px 0 32px" }}/>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 400, fontSize: 32, letterSpacing: "-0.01em", lineHeight: 1.4, color: "#aaa", maxWidth: 880, textWrap: "pretty" }}>
              {body}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <CTAButton label="Get Started" inverse />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#666", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "halftone") {
    // Halftone "?" lives in its OWN corner zone — does not overlap any text.
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#999" }}>FACT / {number}</div>
          </div>

          {/* Halftone "?" in its own dedicated zone */}
          <div style={{ display: "flex", alignItems: "center", gap: 32, marginTop: -20 }}>
            <div style={{
              fontFamily: "'Geist', 'Inter', sans-serif",
              fontWeight: 900,
              fontSize: 380,
              lineHeight: 0.85,
              letterSpacing: "-0.05em",
              backgroundImage: halftoneBg("#000", "#fff"),
              backgroundSize: "32px 32px",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextStroke: "3px #000",
              userSelect: "none",
            }}>?</div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 56, letterSpacing: "-0.025em", lineHeight: 1.0 }}>
              {eyebrow}
            </div>
          </div>

          <div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 700, fontSize: 78, letterSpacing: "-0.035em", lineHeight: 1.05, textWrap: "balance" }}>
              {fact}
            </div>
            <div style={{ width: 80, height: 3, background: "#000", margin: "40px 0 28px" }}/>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 400, fontSize: 30, letterSpacing: "-0.01em", lineHeight: 1.4, color: "#444", textWrap: "pretty" }}>
              {body}
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#999", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "grid") {
    return (
      <Frame bg="#fff" color="#000">
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: gridBg("#000", "#fff", 40),
          backgroundSize: "40px 40px",
        }} />
        {[[40, 40], [1000, 40], [40, 1270], [1000, 1270]].map(([x, y], i) => (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: 40, height: 40 }}>
            <div style={{ position: "absolute", left: 19, top: 0, bottom: 0, width: 2, background: "#000" }}/>
            <div style={{ position: "absolute", top: 19, left: 0, right: 0, height: 2, background: "#000" }}/>
          </div>
        ))}
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", gap: 24 }}>
          <div style={{ background: "#fff", padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #000" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#000" }}>FACT_{number} ▲</div>
          </div>
          <div style={{ background: "#fff", padding: "48px 40px", border: "1px solid #000", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 24 }}>
              ↳ Did you know
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 700, fontSize: 70, letterSpacing: "-0.035em", lineHeight: 1.05, textWrap: "balance" }}>
              {fact}
            </div>
            <div style={{ width: 80, height: 3, background: "#000", margin: "40px 0 28px" }}/>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 400, fontSize: 28, letterSpacing: "-0.01em", lineHeight: 1.4, color: "#000", textWrap: "pretty" }}>
              {body}
            </div>
          </div>
          <div style={{ background: "#fff", padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #000" }}>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#000", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "editorial") {
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 20, borderBottom: "3px solid #000" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>VOL.05 · KNOW MORE · 2026</div>
          </div>
          <div style={{ borderBottom: "1px solid #000", height: 8, marginTop: 4 }}/>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: 40 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 24 }}>
              ◆ Did You Know
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 24 }}>
              <div style={{
                fontFamily: "'Geist', 'Inter', sans-serif",
                fontWeight: 900,
                fontSize: 280,
                letterSpacing: "-0.04em",
                lineHeight: 0.82,
                flexShrink: 0,
              }}>"</div>
              <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 64, letterSpacing: "-0.025em", lineHeight: 1.05, textWrap: "balance", paddingTop: 16 }}>
                {fact}
              </div>
            </div>
            <div style={{ borderTop: "2px solid #000", marginTop: 40, paddingTop: 28 }}>
              <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 400, fontSize: 30, letterSpacing: "-0.005em", lineHeight: 1.45, color: "#000", maxWidth: 920, textWrap: "pretty" }}>
                {body}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "3px solid #000", paddingTop: 32 }}>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#000", textAlign: "right", lineHeight: 1.5, fontWeight: 600 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }
};

window.DYKPost = DYKPost;
