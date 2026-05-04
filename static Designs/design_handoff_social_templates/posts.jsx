/* global React */
const { useMemo } = React;

// ============================================================
// SHARED — Logo / Wordmark
// ============================================================
const Wordmark = ({ color = "#000", size = 18 }) => {
  // Logo native ratio is 1536:545 ≈ 2.82
  // size = the visual height of the wordmark
  const src = color === "#fff" || color === "white" ? "logo-white.png" : "logo-black.png";
  return (
    <img
      src={src}
      alt="Agent Match"
      style={{
        height: size * 2.4,
        width: "auto",
        display: "block",
      }}
    />
  );
};

// Small CTA pill button — always strong + button-style per the brief
const CTAButton = ({ label = "Get Started", inverse = false, full = false }) => {
  const bg = inverse ? "#fff" : "#000";
  const fg = inverse ? "#000" : "#fff";
  return (
    <div style={{
      display: "inline-flex",
      alignItems: "center",
      gap: 10,
      background: bg,
      color: fg,
      padding: "18px 28px",
      borderRadius: 999,
      fontFamily: "'Geist', 'Inter', sans-serif",
      fontWeight: 600,
      fontSize: 22,
      letterSpacing: "-0.01em",
      lineHeight: 1,
      width: full ? "100%" : "auto",
      justifyContent: full ? "space-between" : "flex-start",
    }}>
      <span>{label}</span>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
        <path d="M5 12h14M13 5l7 7-7 7" stroke={fg} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
};

// ============================================================
// FRAME — outer artboard 1080x1350 scaled to 540x675 for canvas
// ============================================================
const Frame = ({ children, bg = "#fff", color = "#000", style = {} }) => (
  <div style={{
    width: 1080,
    height: 1350,
    background: bg,
    color,
    transformOrigin: "top left",
    transform: "scale(0.5)",
    position: "relative",
    overflow: "hidden",
    ...style,
  }}>
    {children}
  </div>
);

// Halftone dot pattern as SVG background
const halftoneBg = (fg = "#000", bg = "#fff") =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><rect width='32' height='32' fill='${bg}'/><circle cx='16' cy='16' r='6' fill='${fg}'/></svg>`
  )}")`;

// Grid pattern
const gridBg = (line = "#000", bg = "#fff", step = 40) =>
  `url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='${step}' height='${step}'><rect width='${step}' height='${step}' fill='${bg}'/><path d='M ${step} 0 L 0 0 0 ${step}' fill='none' stroke='${line}' stroke-width='1' opacity='0.18'/></svg>`
  )}")`;

window.Wordmark = Wordmark;
window.CTAButton = CTAButton;
window.Frame = Frame;
window.halftoneBg = halftoneBg;
window.gridBg = gridBg;
