/* global React, Wordmark, CTAButton, Frame, halftoneBg, gridBg */

// =========================================================================
// PROMOTIONAL TEMPLATE
// Uses the actual brand copy:
//   "The wrong agent can cost you tens of thousands.
//    We find the top 10% so you don't have to.
//    Ready to find your agent?"
// =========================================================================
const PromoPost = ({ theme = "light" }) => {

  const headline = (
    <>
      The wrong agent<br/>
      can cost you<br/>
      <span>tens of thousands.</span>
    </>
  );
  const sub = (
    <>
      We find the <em style={{ fontStyle: "normal", fontWeight: 800 }}>top 10%</em><br/>
      so you don't have to.
    </>
  );
  const kicker = "Ready to find your agent?";

  if (theme === "light") {
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#999" }}>Find your match</div>
          </div>
          <div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 800, fontSize: 124, letterSpacing: "-0.045em", lineHeight: 0.95, textWrap: "balance" }}>
              {headline}
            </div>
            <div style={{ width: 80, height: 3, background: "#000", margin: "44px 0" }}/>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 56, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#444" }}>
              {sub}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 36, letterSpacing: "-0.02em", marginBottom: 24, color: "#000" }}>
              {kicker}
            </div>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#999", textAlign: "right", lineHeight: 1.5, marginTop: 16 }}>
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
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#666" }}>Find your match</div>
          </div>
          <div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 800, fontSize: 124, letterSpacing: "-0.045em", lineHeight: 0.95, textWrap: "balance" }}>
              The wrong agent<br/>
              can cost you<br/>
              <span style={{
                background: "#fff",
                color: "#000",
                padding: "0 16px",
                marginLeft: -16,
                display: "inline-block",
                lineHeight: 1.0,
              }}>tens of thousands.</span>
            </div>
            <div style={{ width: 80, height: 3, background: "#fff", margin: "44px 0" }}/>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 56, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#aaa" }}>
              {sub}
            </div>
          </div>
          <div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 36, letterSpacing: "-0.02em", marginBottom: 24 }}>
              {kicker}
            </div>
            <CTAButton label="Get Started" inverse />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#666", textAlign: "right", lineHeight: 1.5, marginTop: 16 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }

  if (theme === "halftone") {
    // Halftone "10%" sits in its OWN zone (top-right block), separated from the headline.
    return (
      <Frame bg="#fff" color="#000">
        <div style={{ padding: 80, height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", position: "relative" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Wordmark size={28} />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#999" }}>Find your match</div>
          </div>

          {/* Halftone zone — its own block, doesn't overlap text */}
          <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 32, marginTop: 8 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 20, letterSpacing: "0.1em", textTransform: "uppercase", color: "#000", marginBottom: 12 }}>
                We match you with
              </div>
              <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 56, letterSpacing: "-0.025em", lineHeight: 1.0 }}>
                The top
              </div>
            </div>
            <div style={{
              fontFamily: "'Geist', 'Inter', sans-serif",
              fontWeight: 900,
              fontSize: 360,
              letterSpacing: "-0.07em",
              lineHeight: 0.85,
              backgroundImage: halftoneBg("#000", "#fff"),
              backgroundSize: "32px 32px",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              color: "transparent",
              WebkitTextStroke: "3px #000",
              userSelect: "none",
            }}>10%</div>
          </div>

          <div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 800, fontSize: 110, letterSpacing: "-0.045em", lineHeight: 0.95, textWrap: "balance" }}>
              The wrong agent can cost you <span style={{ fontStyle: "italic" }}>tens of thousands.</span>
            </div>
            <div style={{ width: 80, height: 3, background: "#000", margin: "32px 0 24px" }}/>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 44, letterSpacing: "-0.02em", lineHeight: 1.15, color: "#444", maxWidth: 820 }}>
              We find the top 10% so you don't have to.
            </div>
          </div>

          <div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 36, letterSpacing: "-0.02em", marginBottom: 24, color: "#000" }}>
              {kicker}
            </div>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#999", textAlign: "right", lineHeight: 1.5, marginTop: 16 }}>
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
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 18, letterSpacing: "0.08em", textTransform: "uppercase", color: "#000" }}>PROMO ▲</div>
          </div>
          <div style={{ background: "#fff", padding: "48px 40px", border: "1px solid #000", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center" }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 24 }}>
              ↳ Get matched
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 800, fontSize: 104, letterSpacing: "-0.045em", lineHeight: 0.95, textWrap: "balance" }}>
              The wrong agent can cost you <span style={{ borderBottom: "6px solid #000" }}>tens of thousands</span>.
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 46, letterSpacing: "-0.025em", lineHeight: 1.15, color: "#000", marginTop: 36, textWrap: "pretty" }}>
              We find the <span style={{ background: "#000", color: "#fff", padding: "0 12px" }}>top 10%</span> so you don't have to.
            </div>
          </div>
          <div style={{ background: "#fff", padding: "24px 28px", border: "1px solid #000" }}>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 32, letterSpacing: "-0.02em", marginBottom: 20, color: "#000" }}>
              {kicker}
            </div>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#000", textAlign: "right", lineHeight: 1.5, marginTop: 14 }}>
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
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, letterSpacing: "0.08em", textTransform: "uppercase" }}>VOL.05 · ESSENTIAL · 2026</div>
          </div>
          <div style={{ borderBottom: "1px solid #000", height: 8, marginTop: 4 }}/>

          <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", paddingTop: 32 }}>
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 22, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 24 }}>
              ◆ A public service announcement
            </div>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 900, fontSize: 132, letterSpacing: "-0.05em", lineHeight: 0.92, textWrap: "balance" }}>
              The wrong agent can cost you<br/>
              <span style={{ textDecoration: "underline", textDecorationThickness: 8, textUnderlineOffset: 12 }}>tens of thousands.</span>
            </div>
            <div style={{ borderTop: "2px solid #000", marginTop: 40, paddingTop: 32 }}>
              <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 500, fontSize: 52, letterSpacing: "-0.025em", lineHeight: 1.1, color: "#000", textWrap: "pretty" }}>
                We find the <span style={{ fontWeight: 800 }}>top 10%</span> so you don't have to.
              </div>
            </div>
          </div>

          <div style={{ borderTop: "3px solid #000", paddingTop: 24 }}>
            <div style={{ fontFamily: "'Geist', 'Inter', sans-serif", fontWeight: 600, fontSize: 32, letterSpacing: "-0.02em", marginBottom: 20 }}>
              {kicker}
            </div>
            <CTAButton label="Get Started" />
            <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 16, color: "#000", textAlign: "right", lineHeight: 1.5, marginTop: 14, fontWeight: 600 }}>
              agentxmatch.com
            </div>
          </div>
        </div>
      </Frame>
    );
  }
};

window.PromoPost = PromoPost;
