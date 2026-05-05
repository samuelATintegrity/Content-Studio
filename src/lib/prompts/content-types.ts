import type { ContentType } from "../types";

interface AngleSpec {
  key: string;
  brief: string;
  headlineHint: string;
}

interface ContentTypeSpec {
  topic: string;
  guardrails: string;
  // Optional source-of-truth document Claude must draw specifics from
  // (rephrased, never copy-pasted). Used for content where claims must
  // match a documented mission/process.
  referenceDocument?: string;
  angles: AngleSpec[];
}

// AI-poster THEMES — each theme is a message (e.g., "the best" or
// "what's at stake") with multiple visual realizations. Claude picks
// distinct themes for the batch, then picks a visual within each
// theme. This pushes variety into the batch by structure: you don't
// see two "top of the food chain" cards back-to-back, AND within a
// theme there are 7-12 ways to say it so refreshing rotates the
// visual without losing the angle.
//
// Each visual is a Nano Banana Pro seed prompt. Claude rewrites it
// into a fully-fleshed-out prompt at batch time, with a hard
// constraint to never include text/letters/signage in the image.
//
// conceptKey returned by Claude is "<themeKey>:<visualKey>" so the
// cooldown tracker can dedupe at the visual level while the prompt
// shows the theme structure.
export interface AiPosterVisual {
  key: string;
  seed: string;
}

export interface AiPosterTheme {
  key: string;
  message: string; // human-readable message this theme conveys
  mapsTo: string; // good_agents angle this theme argues for
  tone: string;
  visuals: AiPosterVisual[];
}

export const AI_POSTER_THEMES: AiPosterTheme[] = [
  {
    key: "the_best",
    message: "Top of the food chain. Best in class. Elite, world-class, the apex.",
    mapsTo: "top_performers",
    tone: "confident, declarative, top-of-the-food-chain",
    visuals: [
      { key: "tiger_macro", seed: "ultra close-up macro portrait of a tiger's face, intense eye contact with the viewer, dramatic side lighting, fur detail, dark background, photorealistic" },
      { key: "lion_ridge", seed: "majestic male lion standing on a savanna ridge at golden hour, mane rim-lit by the setting sun, deep cinematic shadow on the body, photorealistic" },
      { key: "jaguar_shadow", seed: "black jaguar emerging from deep jungle shadow, only the piercing yellow eyes catching light, dappled leaves, photorealistic" },
      { key: "wolf_alpha", seed: "lone alpha wolf standing on a snowy ridge, looking back over its shoulder, breath visible in cold air, overcast diffuse light, photorealistic" },
      { key: "eagle_flight", seed: "bald eagle in mid-flight with wings fully spread, talons visible, sharp afternoon light catching the feathers, distant mountain backdrop softly out of focus, photorealistic" },
      { key: "racehorse_finish", seed: "thoroughbred racehorse mid-stride at full gallop crossing a finish line, mud kicking up, dramatic motion blur in the background grandstand, photorealistic" },
      { key: "f1_apex", seed: "Formula 1 car frozen at the apex of a corner, sparks flying off the floor, blurred grandstand and trackside marshals, photorealistic" },
      { key: "olympic_podium", seed: "athlete stepping onto the gold-medal podium spot, single dramatic spotlight on the podium, surrounding stadium fading into deep shadow, photorealistic" },
      { key: "top_shelf_bottle", seed: "a single rare aged spirit bottle on a dark stone bar, dramatic spotlight from above, dust motes glittering in the beam, photorealistic" },
      { key: "everest_summit", seed: "lone climber standing at the summit of Everest at sunrise, prayer flags whipping in the wind, infinite peaks below, photorealistic, cinematic" },
    ],
  },
  {
    key: "pretenders",
    message: "Looks the part, isn't. Calling out posers, decoys, and surface-only credentials.",
    mapsTo: "filters_part_time",
    tone: "wry, contrarian, calling out pretenders",
    visuals: [
      { key: "chameleon_suit", seed: "studio portrait of a chameleon wearing a tiny tailored business suit and tie, head-and-shoulders framing, soft key light on a neutral backdrop, photorealistic" },
      { key: "chihuahua_vs_dane", seed: "studio shot of a majestic great dane standing tall next to a tiny chihuahua wearing an oversized business suit, neutral seamless backdrop, photorealistic" },
      { key: "cardboard_storefront", seed: "back view of a movie-set Western storefront — looks like a real building from the front, just propped lumber from behind, dusty backlot, photorealistic" },
      { key: "mannequin_handshake", seed: "two business-suited mannequins posed mid-handshake on a department-store sales floor, photorealistic, slightly uncanny" },
      { key: "inflatable_lawyer", seed: "inflatable wacky-arm tube man dressed in a tailored business suit, parked in front of a small office building, photorealistic" },
      { key: "paper_crown", seed: "an obviously paper Burger-King-style crown displayed on a velvet pillow under a museum spotlight, photorealistic" },
      { key: "cardboard_armor", seed: "knight's armor made of cardboard and tinfoil, propped against a stone castle wall, photorealistic" },
      { key: "deflated_mascot", seed: "deflated furry sports mascot suit slumped against a locker-room bench, oversized head detached on the floor, photorealistic" },
      { key: "fake_rolex", seed: "macro shot of a clearly fake gold watch with misspelled brand etched on the face, on a velvet display, photorealistic" },
    ],
  },
  {
    key: "slow_loses",
    message: "Slow gets left behind. Speed wins. Hesitation costs the deal.",
    mapsTo: "pre_interviewed",
    tone: "pointed, urgency-driven, slow agents lose deals",
    visuals: [
      { key: "sloth_macro", seed: "extreme macro close-up portrait of a three-toed sloth's face, slow-blinking eyes, soft jungle backlight, mossy fur detail, photorealistic" },
      { key: "snail_highway", seed: "single garden snail crossing the painted lane line of a busy highway, low angle, motion blur of a passing car, photorealistic" },
      { key: "melting_clock", seed: "wax candle shaped like a clock, melting and warping on a wooden table, late afternoon light, photorealistic" },
      { key: "traffic_solo", seed: "lone car stuck in a vast sea of red brake lights stretching to the horizon at dusk, aerial view, photorealistic" },
      { key: "hourglass_empty", seed: "hourglass with nearly all the sand pooled at the bottom, dramatic side light, dust glittering, photorealistic, macro" },
      { key: "frozen_loading", seed: "phone screen frozen on a loading spinner, hand reaching toward it in frustration, photorealistic, macro" },
      { key: "molasses_pour", seed: "thick molasses pouring extremely slowly from a tipped jar over a stack of paperwork, photorealistic" },
      { key: "sleeping_guard", seed: "security guard asleep at a desk while monitors behind show motion alerts flashing red, photorealistic" },
      { key: "rusted_gear", seed: "macro shot of a single rusted gear seized in place, surrounded by smoothly turning gears, photorealistic" },
    ],
  },
  {
    key: "stakes_high",
    message: "What happens when you pick wrong. The disaster scenario. Real stakes.",
    mapsTo: "why_quality_matters",
    tone: "warning, stakes-driven, what's at risk",
    visuals: [
      { key: "exploding_home", seed: "a suburban American home mid-explosion captured at the peak frame, debris and shingles frozen in midair, fire and smoke billowing, dramatic golden-hour lighting, photorealistic" },
      { key: "underwater_home", seed: "a pristine modern American suburban home fully submerged underwater in a vast deep ocean, sun rays piercing the water from above, bubbles, surreal cinematic composition, photorealistic" },
      { key: "sinkhole_home", seed: "modern American suburban home half-sunk into a giant sinkhole on its own front lawn, neighbors' homes intact in background, photorealistic" },
      { key: "house_of_cards", seed: "a literal house of playing cards mid-collapse on a kitchen table, the top cards starting to fall, shallow depth of field, photorealistic" },
      { key: "tornado_approach", seed: "lone American suburban home in foreground with a massive tornado bearing down across an open field behind it, dramatic storm light, photorealistic" },
      { key: "flooded_living_room", seed: "elegant living room interior submerged waist-deep in clear water, couch and lamps still in place, photorealistic, surreal" },
      { key: "cracking_foundation", seed: "ground-level view of a giant crack splitting the foundation of a beautiful brick home in two, photorealistic, dramatic" },
      { key: "falling_piano", seed: "a grand piano captured mid-fall above a residential rooftop, frozen in motion against a clear blue sky, photorealistic, surreal" },
      { key: "burning_paperwork", seed: "stack of mortgage paperwork on a desk catching fire, flames just starting to spread across the top sheet, photorealistic, dramatic" },
    ],
  },
  {
    key: "lone_standout",
    message: "Standing when others fell. Results that hold up. The one that survived.",
    mapsTo: "proven_reviews",
    tone: "survivor, standout, results that hold up",
    visuals: [
      { key: "untouched_home", seed: "a single pristine modern home standing untouched, surrounded by smoldering burnt-out wreckage of other homes, dawn light, atmospheric haze, photorealistic, dramatic" },
      { key: "lighthouse_storm", seed: "lone lighthouse with its beam cutting through a violent sea storm at night, towering waves crashing around it, photorealistic, cinematic" },
      { key: "oak_burned_forest", seed: "single living oak tree in full green leaf standing in the middle of a vast burnt-black forest floor, photorealistic" },
      { key: "one_lit_window", seed: "aerial night shot of a city block during a blackout — every building dark except one warmly glowing window, photorealistic" },
      { key: "flag_planted", seed: "a single flag planted upright on a windswept ridge after a battle, broken weapons and helmets in foreground, dramatic dusk light, photorealistic" },
      { key: "rose_in_desert", seed: "single perfect rose blooming through a crack in a vast cracked-mud desert plain, photorealistic, macro, golden hour" },
      { key: "ship_among_wrecks", seed: "single ship sailing intact through a graveyard of shipwrecks visible at low tide, photorealistic, atmospheric" },
      { key: "trophy_only_one", seed: "single championship trophy displayed in a vast empty trophy case with dozens of empty shelves, dramatic spotlight, photorealistic" },
    ],
  },
  {
    key: "predator_watch",
    message: "Watch out. Hidden danger circling. Look closer before you trust.",
    mapsTo: "filters_part_time",
    tone: "warning, watch out for predators",
    visuals: [
      { key: "shark_below", seed: "extreme close-up of a great white shark's open mouth and rows of teeth, viewed from below, dark blue water, light rays piercing down, photorealistic, ominous" },
      { key: "wolf_in_fleece", seed: "wolf wearing a sheep's fleece draped over its back, standing among real sheep in a field, golden hour, photorealistic" },
      { key: "snake_in_grass", seed: "venomous snake coiled motionless and almost invisible in tall grass, only its eyes and tongue visible, photorealistic, macro" },
      { key: "vultures_circling", seed: "low-angle silhouette of vultures circling overhead against a blazing sun in a clear sky, photorealistic, ominous" },
      { key: "spider_web_dawn", seed: "ornate spider web glistening with dew at dawn, the spider hidden waiting at the corner, photorealistic, macro" },
      { key: "shark_fin_surface", seed: "ominous shark fin breaking the surface of a calm sunset ocean, distant beach silhouettes, photorealistic" },
      { key: "alligator_eyes_swamp", seed: "only the eyes and ridge of an alligator visible above a still swamp surface at dusk, photorealistic" },
      { key: "trojan_horse", seed: "ornate wooden horse statue at city gates at dawn, defenders unaware, photorealistic, cinematic" },
    ],
  },
  {
    key: "right_tool",
    message: "The right tool for your specific situation. Generic doesn't fit.",
    mapsTo: "situation_goals",
    tone: "precision, specificity, fit-for-purpose",
    visuals: [
      { key: "scalpel_vs_butter", seed: "side-by-side studio shot of a precision surgical scalpel next to a dull butter knife on a clean white surface, dramatic side light, photorealistic, macro" },
      { key: "swiss_army_open", seed: "swiss army knife with every tool unfolded, studio lit on dark slate, photorealistic, macro" },
      { key: "bespoke_suit_form", seed: "tailor's measuring tape draped over a perfectly cut bespoke suit on a wooden form, soft window light in an atelier, photorealistic" },
      { key: "right_key", seed: "ring of dozens of mismatched keys with one single golden key being lifted away, photorealistic, macro" },
      { key: "chef_knife_row", seed: "row of professional chef knives by size on a magnetic strip, single one missing from the lineup, photorealistic" },
      { key: "puzzle_last_piece", seed: "single puzzle piece hovering above the one empty slot in a nearly-complete jigsaw puzzle, macro, photorealistic" },
      { key: "lens_kit", seed: "optometrist's lens kit with one perfect lens highlighted by a dramatic beam of light, photorealistic, macro" },
      { key: "tailored_glove", seed: "perfectly fitted leather glove being slid onto a hand, soft natural light, photorealistic, macro" },
      { key: "right_size_wrench", seed: "row of wrenches arranged by size with one being lifted from the lineup, dramatic workshop lighting, photorealistic" },
    ],
  },
  {
    key: "hidden_value",
    message: "Most of the value is below the surface. The visible part is the small part.",
    mapsTo: "proven_reviews",
    tone: "depth, what's underneath, the unseen 90%",
    visuals: [
      { key: "iceberg_underwater", seed: "iceberg from a cross-section perspective showing the small visible peak above the waterline and the massive blue-tinged mass extending down underwater, photorealistic, dramatic" },
      { key: "tree_roots", seed: "cross-section view of a mature tree showing its root system extending down into the earth as deep and wide as the canopy is tall, photoreal illustration" },
      { key: "geyser_eruption", seed: "dramatic close-up of a geyser at the moment of eruption, plumes of steam catching morning light, photorealistic" },
      { key: "oil_rig_cross_section", seed: "cross-section illustration of an offshore oil rig — the platform tiny above water and the structure extending hundreds of feet below to the seabed, photorealistic" },
      { key: "foundation_layers", seed: "cross-section view of a building foundation cut away, showing the massive concrete and steel reinforcement below ground supporting the modest house above, photorealistic" },
      { key: "whale_under_surface", seed: "single whale tail breaching above the ocean surface, faint massive silhouette of the whole whale visible underwater below, photorealistic" },
      { key: "swan_paddling", seed: "split-level shot of a swan gliding serenely above water with its feet paddling furiously below the surface, photorealistic" },
    ],
  },
];

// Headline variants the model should pick from, lightly tweaking word choice
// (Buy / Purchase / Own / Options for / Homes with) but always keeping the topic
// anchor (e.g. "$0 Down") in the phrase.
export const CONTENT_TYPE_SPECS: Record<ContentType, ContentTypeSpec> = {
  zero_down_generic: {
    topic: "$0-down home loan options for first-time buyers",
    guardrails:
      "Never promise approval, guaranteed rates, or specific dollar savings. Avoid 'free money' framing. Mention that programs vary by qualification and area. Always invite the reader to fill out the form for a personal consult.",
    angles: [
      { key: "qualification_basics", brief: "Quick rundown of what makes someone eligible for $0-down loans.", headlineHint: "Who Qualifies for $0 Down" },
      { key: "success_story", brief: "Hypothetical client who closed with $0 down and what changed for them.", headlineHint: "Closed with $0 Down" },
      { key: "faq_credit", brief: "FAQ about credit scores for $0-down loans.", headlineHint: "Credit for $0 Down" },
      { key: "step_by_step", brief: "Three steps to start the $0-down process this month.", headlineHint: "Start with $0 Down" },
      { key: "cost_breakdown", brief: "Closing costs and other expenses beyond a $0 down payment.", headlineHint: "Beyond $0 Down" },
      { key: "urgency_market", brief: "Why now is a smart window to explore $0-down options.", headlineHint: "Homes with $0 Down" },
      { key: "cta_consult", brief: "Direct invitation to fill out the form for a free 15-minute consult.", headlineHint: "Options for $0 Down" },
    ],
  },

  edu_zero_down_usda_local: {
    topic: "$0-down loans through USDA and local bank programs",
    guardrails:
      "USDA loans are for eligible rural and suburban areas, say so. Local bank programs vary; never name specific banks unless the user provides them. No guaranteed approval language.",
    angles: [
      { key: "usda_overview", brief: "Plain-English explainer: what is a USDA loan?", headlineHint: "USDA $0 Down Basics" },
      { key: "usda_eligibility_area", brief: "How to check if a property is in a USDA-eligible area.", headlineHint: "USDA Eligible Areas" },
      { key: "usda_eligibility_income", brief: "USDA income limits, how they work, why they exist.", headlineHint: "USDA Income Limits" },
      { key: "usda_vs_fha", brief: "Quick compare: USDA vs FHA for first-time buyers.", headlineHint: "USDA or FHA Loans" },
      { key: "local_bank_programs", brief: "Why local banks sometimes have better $0-down options than national lenders.", headlineHint: "Local Bank $0 Down" },
      { key: "credit_union_angle", brief: "Credit unions and community banks, the underrated $0-down path.", headlineHint: "Credit Union $0 Down" },
      { key: "myth_rural_only", brief: "Bust the myth that USDA equals farmland only.", headlineHint: "USDA Beyond the Farm" },
      { key: "fees_truth", brief: "The real costs on a USDA loan (guarantee fee, etc.) explained simply.", headlineHint: "USDA True Costs" },
      { key: "timeline", brief: "Realistic timeline from pre-approval to keys on a USDA loan.", headlineHint: "USDA Loan Timeline" },
      { key: "cta_eligibility_check", brief: "Invite reader to fill out the form for a free USDA eligibility check.", headlineHint: "USDA Eligibility Check" },
    ],
  },

  edu_dpa_local: {
    topic: "Down payment assistance through local (state, county, and city) programs",
    guardrails:
      "Stay focused on STATE, COUNTY, and CITY-level DPA programs. Don't claim specific dollar amounts unless given. Funds run out, say so. Some DPAs are forgivable grants, some are silent second mortgages, some are 0% deferred loans — clarify which when relevant. Do NOT promote federal HUD-Good-Neighbor, employer-assisted DPA, or other niche/national paths — the brand is steering toward locally-administered programs that any qualifying buyer can access. Programs vary by state/county/city, so don't claim universal availability.",
    angles: [
      { key: "dpa_what_is", brief: "What is down payment assistance, in plain terms? Frame as state/county/city programs.", headlineHint: "Down Payment Assistance" },
      { key: "dpa_grant_vs_loan", brief: "Grant vs. forgivable loan vs. silent second, the three flavors of local DPA.", headlineHint: "Types of DPA Programs" },
      { key: "dpa_who_qualifies", brief: "Typical qualification criteria for state/county/city DPA programs.", headlineHint: "DPA Qualifications" },
      { key: "dpa_first_time_def", brief: "What counts as a first-time buyer for DPA purposes (often broader than people think).", headlineHint: "DPA First-Time Buyers" },
      { key: "dpa_stack_with_loan", brief: "How local DPA stacks on top of FHA, conventional, or VA loans.", headlineHint: "Stacking DPA Programs" },
      { key: "dpa_funds_run_out", brief: "Why DPA programs run out of funds and how to plan around it.", headlineHint: "DPA Funds Run Out" },
      { key: "dpa_state_vs_local", brief: "Why a city or county program sometimes beats a state program (and vice-versa).", headlineHint: "State or Local DPA" },
      { key: "dpa_credit_score", brief: "Minimum credit considerations for most local DPA programs.", headlineHint: "Credit and DPA" },
      { key: "dpa_homebuyer_class", brief: "Most local DPAs require a HUD-approved homebuyer education class — what that involves.", headlineHint: "DPA Education Classes" },
      { key: "cta_program_match", brief: "Invite reader to fill out the form to get matched to local DPA programs.", headlineHint: "Find Your DPA Match" },
    ],
  },

  good_agents: {
    topic: "How we match homebuyers with the right agent (our mission and matching process), plus industry data on why agent quality matters",
    guardrails:
      "Use specifics from the reference document below; rephrase naturally, never copy verbatim. Permitted quantitative claims are ONLY: (a) 'top 10%' and '4.8 stars or higher' from the matching mission, and (b) the industry stats explicitly listed in the INDUSTRY DATA section below — every one of those is sourced and you may use any of them verbatim or paraphrased. Do NOT invent any other numbers, percentages, dollar amounts, or counts. Do NOT promise outcomes (sale prices, savings, timelines). The headline must contain 'agent' or 'agents'.",
    referenceDocument: `HOW WE MATCH YOU WITH THE RIGHT AGENT
Different agents have different specialties. We review multiple factors to connect each homebuyer with the right fit.

1. Buy or Sell Focus
Some agents specialize in working with buyers, while others focus on helping sellers maximize their sale. We match you with an agent who primarily operates on your side of the transaction.

2. Your Situation and Goals
Whether you're a first-time homebuyer, purchasing a primary residence, or investing for returns, your strategy matters. We connect you with agents who specialize in your exact situation so you get guidance tailored to your goals.

3. Home Price
Real estate varies significantly by price point, and not every agent operates in every range. We match you with agents who consistently work within your budget and understand that segment of the market.

4. Top Performers Only
We prioritize agents who rank in the top 10% within their market and price range. This filters out part-time or inexperienced agents and ensures you're working with proven professionals.

5. Proven Reviews
We only match agents with an aggregate rating of 4.8 stars or higher across major platforms. This ensures a consistent track record of strong client experiences.

6. Interviewed Before Introduction
Before making an introduction, we speak directly with the agent. This ensures they are responsive, professional, and ready to help when you're connected.

INDUSTRY DATA (every stat below is sourced; you may use the number verbatim and paraphrase the meaning)

A. NAR 2024 Member Profile — typical agent volume
The median REALTOR® closed 10 transaction sides in the prior 12 months. About half of all licensed agents close fewer than 10 sides per year. Source: National Association of REALTORS® 2024 Member Profile. Permitted number: 10. Permitted phrasing: "median agent closes about 10 sides a year", "half of agents close fewer than 10 a year".

B. NAR 2024 Member Profile — newer agents
Roughly 4 in 10 REALTORS® have 5 or fewer years of experience in the industry. Source: NAR 2024 Member Profile. Permitted numbers: 40 (as a percentage), 5 (years). Permitted phrasing: "40% of agents have 5 years or less experience", "4 in 10 agents have under 5 years in the business".

C. NAR 2024 Profile of Home Buyers and Sellers — buyers shopping for an agent
Most homebuyers interview just one agent before hiring. NAR's 2024 Profile of Home Buyers and Sellers shows the typical buyer contacted only one agent before choosing one. Source: NAR 2024 Profile of Home Buyers and Sellers. Permitted phrasing: "most buyers interview only one agent", "the typical buyer contacts just one agent". Avoid quoting an exact percentage — keep it qualitative.

D. NAR 2024 Profile of Home Buyers and Sellers — would use again
89% of buyers said they would use their real estate agent again or recommend the agent to others. Source: NAR 2024 Profile of Home Buyers and Sellers. Permitted number: 89. Permitted phrasing: "89% of buyers would use their agent again or recommend them".

E. Agent retention in the industry
Roughly 75–80% of new real estate agents leave the business within their first 5 years. Source: widely reported NAR / industry retention data; the round figure most often cited is "about 8 in 10". Permitted phrasing: "roughly 8 in 10 new agents leave the business within 5 years", "most new agents are gone within 5 years". Permitted number: 80 (or "8 in 10"). Do NOT pin to a year other than "the first 5 years".

F. Production concentration
A small share of agents handles a large share of transactions — the top 10% of agents handle the majority of deals in most markets. This aligns with our matching mission ("top 10%"). Permitted phrasing: "the top 10% of agents close most of the deals in their market". Source: industry production data.

How to use the data above for stat callouts: pick ONE number per post. Put the bare number in the 'number' field (e.g., "10", "40", "89", "80"), the suffix in the 'unit' field ("%", "+", or empty), and a one-line meaning in the 'statement' field that explicitly ties the stat to the value of choosing a vetted agent (e.g., "of agents close fewer than 10 deals a year — yours should not be one of them"). Always credit the source generically (e.g., "NAR Member Profile, 2024") in the source field.`,
    angles: [
      { key: "mission_overview", brief: "Plain-English intro to how the matching process works.", headlineHint: "How We Match Agents" },
      { key: "buy_sell_focus", brief: "Why agents who focus on buyers vs. sellers matters, and how we match by side of transaction.", headlineHint: "Buyer-Side Agents" },
      { key: "situation_goals", brief: "How we match agents to your situation (first-time, primary, investor) and goals.", headlineHint: "Agents for Your Goals" },
      { key: "price_match", brief: "Why a price-range fit matters and how we match agents who consistently work in your budget segment.", headlineHint: "Agent for Your Price" },
      { key: "top_performers", brief: "We prioritize agents who rank in the top 10% within their market and price range.", headlineHint: "Top 10% Agents Only" },
      { key: "proven_reviews", brief: "We only match agents with an aggregate 4.8 stars or higher across major review platforms.", headlineHint: "4.8-Star Agents Only" },
      { key: "pre_interviewed", brief: "Every agent is personally interviewed before we make an introduction.", headlineHint: "Pre-Interviewed Agents" },
      { key: "filters_part_time", brief: "Why our screening filters out part-time and inexperienced agents.", headlineHint: "No Part-Time Agents" },
      { key: "why_quality_matters", brief: "Why working with the right agent matters more than working with any agent.", headlineHint: "The Right Agent Matters" },
      { key: "cta_get_matched", brief: "Direct invitation to fill out the form and get matched with a vetted agent.", headlineHint: "Find Your Agent" },
      // Industry-data angles. Each one anchors on a specific stat from
      // the INDUSTRY DATA section above and ties it to why a vetted
      // agent matters. Only used for stat-template batches in practice
      // (the photo-static + video pipelines pull from the matching-
      // mission angles), but they're valid here too.
      { key: "stat_median_volume", brief: "Use the NAR median (10 transaction sides per year) to underscore that most agents are part-time-volume agents — and why a top performer is a different tier. Source the number to NAR.", headlineHint: "Most Agents Close 10 a Year" },
      { key: "stat_newer_agents", brief: "Use the NAR figure that ~40% of agents have 5 years or less experience. Frame as: a vetted match avoids learning on your dime.", headlineHint: "40% Are New Agents" },
      { key: "stat_one_interview", brief: "Use the NAR finding that most buyers interview only one agent. Frame as: most buyers don't shop, which is why getting matched to a top performer up front matters. Keep the stat qualitative — don't quote a percent.", headlineHint: "Buyers Interview Just One" },
      { key: "stat_would_use_again", brief: "Use the NAR figure that 89% of buyers would use their agent again. Frame as: when the match is right, buyers stick with that agent for life — start with the right one.", headlineHint: "89% Would Use Again" },
      { key: "stat_attrition", brief: "Use the industry figure that roughly 8 in 10 new agents leave the business within 5 years. Frame as: experience and longevity are signal, not noise — our top 10% have proven staying power.", headlineHint: "8 in 10 Agents Quit" },
      { key: "stat_top_10_concentration", brief: "Use the production-concentration data — the top 10% of agents close the majority of deals in their market. Frame as: that's exactly the cohort we match you to.", headlineHint: "Top 10% Closes Most Deals" },
    ],
  },

  edu_physician_loans: {
    topic: "Physician / medical professional home loans (low- or no-down, no PMI)",
    guardrails:
      "Eligibility varies by lender — common eligible degrees include MD, DO, DDS, DMD, DVM, and many lenders also accept PA, NP, and pharmacists. Never guarantee approval, rates, or specific dollar terms. Don't name specific banks unless the user provides them. Student-loan handling differs by lender (income-driven payments often counted favorably) — describe directionally, not as a guaranteed rule. Avoid clinical jargon; this is for a general homebuyer audience.",
    angles: [
      { key: "physician_basics", brief: "Plain-English explainer: what a physician home loan is and why it exists.", headlineHint: "Physician Home Loans 101" },
      { key: "physician_eligible_pros", brief: "Which medical professions typically qualify (MD, DO, DDS, DMD, DVM, often PA/NP/pharmacist).", headlineHint: "Who Qualifies" },
      { key: "physician_no_pmi", brief: "Why physician loans usually skip PMI even with low down payment.", headlineHint: "Skip the PMI" },
      { key: "physician_student_debt", brief: "How physician loans treat student-loan payments (often friendlier debt-to-income calc).", headlineHint: "Student Loans, Counted Right" },
      { key: "physician_residency_buy", brief: "Buying during residency or fellowship with future-income provisions.", headlineHint: "Buy During Residency" },
      { key: "physician_dental_vet", brief: "Dental and veterinary professionals are often eligible too — frequently overlooked.", headlineHint: "Dentists and Vets, Too" },
    ],
  },

  edu_hero_loans: {
    topic: "Local (state, county, city) down-payment assistance programs that include enhanced tiers for community professionals — teachers, nurses, first responders, law enforcement",
    guardrails:
      "These angles are about LOCAL DPAs (state / county / city) that often have a separate enhanced tier or bonus benefit for community-service professions. Stay general — never name a specific city or state program unless given by the user. Don't promote federal HUD Good Neighbor Next Door, the VA loan, or employer-assisted DPA — the brand is steering toward locally-administered programs. Frame: 'your state or county DPA program may have a higher loan amount, lower interest rate, or extra grant for [profession]'. Funds run out, eligibility varies, never guarantee a specific dollar amount or approval. The hero benefit is a TIER on top of standard local DPA, not a separate federal program.",
    angles: [
      { key: "heroes_overview", brief: "Plain-English explainer: many local (state/county/city) DPAs include enhanced tiers for community professionals on top of the standard program.", headlineHint: "Local DPA for Community Heroes" },
      { key: "hero_teachers", brief: "How local DPAs often add a teacher tier (e.g., higher grant amount, lower rate) on top of the standard program — varies by state/county/city.", headlineHint: "Teacher DPA Tiers" },
      { key: "hero_nurses", brief: "Nurses and other healthcare workers frequently qualify for an enhanced tier on local DPAs — the bonus stacks on the standard program.", headlineHint: "Nurse DPA Tiers" },
      { key: "hero_first_responders", brief: "Firefighters and EMTs often qualify for the same community-professional bonus tier on local DPAs.", headlineHint: "First Responder DPA" },
      { key: "hero_law_enforcement", brief: "Law enforcement officers commonly qualify for an enhanced tier on local DPAs — extra grant or better terms vs. the standard program.", headlineHint: "Law Enforcement DPA" },
      { key: "hero_eligibility_check", brief: "How to check whether your state, county, or city has a community-professional tier on its local DPA program.", headlineHint: "Check Local Tiers" },
      { key: "hero_stack_dpa", brief: "How a community-professional tier stacks WITH (not instead of) the standard local DPA — sometimes you qualify for both layers.", headlineHint: "Stack Both DPA Layers" },
      { key: "hero_funds_run_out", brief: "Hero tiers run out of funds the same way standard DPA does — being matched with a lender who tracks your local funding window matters.", headlineHint: "Funds Run Fast" },
    ],
  },

  language_match: {
    topic: "Working with real estate agents and loan officers who speak your language",
    guardrails:
      "Be respectful and inclusive, never frame language barriers as a buyer's failing. Emphasize that buyers deserve service in their preferred language. Avoid stereotyping any community.",
    angles: [
      { key: "trust_in_native_lang", brief: "Why doing the biggest purchase of your life in your native language matters.", headlineHint: "Buy in Your Language" },
      { key: "translation_pitfalls", brief: "What gets lost when key mortgage terms are translated on the fly.", headlineHint: "Lost in Translation" },
      { key: "family_decision", brief: "Buying a home is a family decision, your parents and elders deserve to understand too.", headlineHint: "Family in Your Language" },
      { key: "doc_walkthrough", brief: "We walk through every document with you, in your language.", headlineHint: "Docs in Your Language" },
      { key: "cultural_context", brief: "Beyond language, cultural context in real estate decisions.", headlineHint: "Culture and Buying" },
      { key: "first_gen_buyers", brief: "First-generation buyers, you are not alone in this process.", headlineHint: "First-Gen Home Buyers" },
      { key: "ask_anything", brief: "No question is wrong when it's in your second language. Ask in your first.", headlineHint: "Ask in Your Language" },
      { key: "team_intro", brief: "Meet our multilingual team (placeholder, keep generic until names provided).", headlineHint: "Our Multilingual Team" },
      { key: "myth_extra_cost", brief: "Bust the myth that working with a multilingual agent costs more.", headlineHint: "Same Cost, Your Language" },
      { key: "cta_dm_native", brief: "Invitation to fill out the form in their preferred language.", headlineHint: "Connect in Your Language" },
    ],
  },
};
