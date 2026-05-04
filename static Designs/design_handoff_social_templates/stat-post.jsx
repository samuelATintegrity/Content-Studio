/* global React, Wordmark, CTAButton, Frame, halftoneBg, gridBg */

// =========================================================================
// STATISTIC TEMPLATE
// Composition: eyebrow + massive number + statement + source tag + CTA
// =========================================================================
const StatPost = ({ theme = "light", number = "73%", unit = "", statement = "of homes sell within 30 days when listed by a top 10% agent.", source = "Source: NAR, 2024" }) => {

  if (theme === "light") {
    // Pure black on white — clean editorial
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#999" }}>By the numbers / 01</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase", color: "#000", marginBottom: 32, display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ width: 40, height: 2, background: "#000" }}></span>
              The Stat
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 800, fontSize: 380, letterSpacing: "-0.06em", lineHeight: 0.85, color: "#000" }}>
              {number}<span style={{ fontSize: 200 }}>{unit}</span>
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 52, letterSpacing: "-0.025em", lineHeight: 1.1, marginTop: 48, maxWidth: 880, textWrap: "pretty" }}>
              {statement}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#999", marginTop: 32, letterSpacing: "0.04em" }}>
              {source}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <CTAButton label="Find Your Agent" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#999", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com<br />
              <span style={{ color: "#ccc" }}>swipe →</span>
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "inverse") {
    // White on black
    return (
      <Frame bg="#000" color="#fff">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark color="#fff" size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666" }}>By the numbers / 02</div>
          </div>
          <div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase", color: "#fff", marginBottom: 32, display: "flex", alignItems: "center", gap: 16 }}>
              <span style={{ width: 40, height: 2, background: "#fff" }}></span>
              The Stat
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 800, fontSize: 380, letterSpacing: "-0.06em", lineHeight: 0.85 }}>
              {number}<span style={{ fontSize: 200 }}>{unit}</span>
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 52, letterSpacing: "-0.025em", lineHeight: 1.1, marginTop: 48, maxWidth: 880, textWrap: "pretty" }}>
              {statement}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#666", marginTop: 32, letterSpacing: "0.04em" }}>
              {source}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <CTAButton label="Find Your Agent" inverse />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#666", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "halftone") {
    // Big number filled with halftone, on white
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#999" }}>By the numbers / 03</div>
          </div>
          <div style={{ position: "relative" }}>
            <div style={{
              fontFamily: "'Geist', 'Inter', sans-serif",
              fontWeight: 900,
              fontSize: 460,
              letterSpacing: "-0.07em",
              lineHeight: 0.85,
              backgroundImage: halftoneBg("#000", "#fff"),
              backgroundSize: "32px 32px",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextStroke: "3px #000",
            }}>
              {number}{unit}
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 52, letterSpacing: "-0.025em", lineHeight: 1.1, marginTop: 32, maxWidth: 880, textWrap: "pretty" }}>
              {statement}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#666", marginTop: 28, letterSpacing: "0.04em" }}>
              {source}
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <CTAButton label="Find Your Agent" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#999", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "grid") {
    // Technical grid background with measurement marks
    return (
      <Frame bg="#fff" color="#000">
        <div style={{
          position: "absolute", inset: 0,
          backgroundImage: gridBg("#000", "#fff", 40),
          backgroundSize: "40px 40px",
        }} />
        {/* Crosshair markers in corners */}
        {[[40, 40], [1000, 40], [40, 1270], [1000, 1270]].map(([x, y], i) => (
          <div key={i} style={{ position: "absolute", left: x, top: y, width: 40, height: 40 }}>
            <div style={{ position: "absolute", left: 19, top: 0, bottom: 0, width: 2, background: "#000" }}/>
            <div style={{ position: "absolute", top: 19, left: 0, right: 0, height: 2, background: "#000" }}/>
          </div>
        ))}
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative", gap: 24 }}>
          <div style={{ background: "#fff", padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #000" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#000" }}>STAT_04 ▲</div>
          </div>
          <div style={{ background: "#fff", padding: "48px 40px", border: "1px solid #000", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, letterSpacing: "0.08em", textTransform: "uppercase", color: "#000", marginBottom: 24 }}>
              ↳ data point
            </div>
            <div style={{
              fontFamily: "'Geist', 'Inter', sans-serif",
              fontWeight: 800,
              fontSize: 360,
              letterSpacing: "-0.06em",
              lineHeight: 0.85,
            }}>
              {number}{unit}
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 46, letterSpacing: "-0.025em", lineHeight: 1.15, marginTop: 40, textWrap: "pretty" }}>
              {statement}
            </div>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#000", marginTop: 24, letterSpacing: "0.04em" }}>
              {source}
            </div>
          </div>
          <div style={{ background: "#fff", padding: "20px 24px", display: "flex", justifyContent: "space-between", alignItems: "center", border: "1px solid #000" }}>
            <CTAButton label="Find Your Agent" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#000", textAlign: "right", lineHeight: 1.5 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "editorial") {
    // Newspaper-style with rules and serif-ish drop cap feel (still bold sans)
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column" }}>
          {/* masthead */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", paddingBottom: 20, borderBottom: "3px solid #000" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>VOL.05 · STATISTICS · 2026</div>
          </div>
          <div style={{ borderBottom: "1px solid #000", height: 8, marginTop: 4 }}/>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: 40 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 24 }}>
              ◆ The Statistic
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 32 }}>
              <div style={{
                fontFamily: "'Geist', 'Inter', sans-serif",
                fontWeight: 900,
                fontSize: 360,
                letterSpacing: "-0.07em",
                lineHeight: 0.82,
                flexShrink: 0,
              }}>
                {number}{unit}
              </div>
            </div>
            <div style={{ borderTop: "2px solid #000", marginTop: 32, paddingTop: 32 }}>
              <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 56, letterSpacing: "-0.025em", lineHeight: 1.05, maxWidth: 920, textWrap: "balance" }}>
                "{statement}"
              </div>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, color: "#666", marginTop: 24, letterSpacing: "0.04em" }}>
                — {source}
              </div>
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: "3px solid #000", paddingTop: 32 }}>
            <CTAButton label="Find Your Agent" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#000", textAlign: "right", lineHeight: 1.5, fontWeight: 600 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }
};

window.StatPost = StatPost;
