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
    topic: "Down payment assistance through local programs",
    guardrails:
      "DPA programs vary by state, county, and city. Don't claim specific dollar amounts unless given. Funds run out, say so. Some DPAs are forgivable, some are second mortgages, clarify which when relevant.",
    angles: [
      { key: "dpa_what_is", brief: "What is down payment assistance, in plain terms?", headlineHint: "Down Payment Assistance" },
      { key: "dpa_grant_vs_loan", brief: "Grant vs. forgivable loan vs. silent second, the three flavors of DPA.", headlineHint: "Types of DPA Programs" },
      { key: "dpa_who_qualifies", brief: "Typical qualification criteria for local DPA programs.", headlineHint: "DPA Qualifications" },
      { key: "dpa_first_time_def", brief: "What counts as a first-time buyer for DPA purposes (often broader than people think).", headlineHint: "DPA First-Time Buyers" },
      { key: "dpa_stack_with_loan", brief: "How DPA stacks on top of FHA, conventional, or VA loans.", headlineHint: "Stacking DPA Programs" },
      { key: "dpa_funds_run_out", brief: "Why DPA programs run out of funds and how to plan around it.", headlineHint: "DPA Funds Run Out" },
      { key: "dpa_employer", brief: "Employer-assisted DPA, a path many buyers miss.", headlineHint: "Employer DPA Programs" },
      { key: "dpa_teacher_nurse", brief: "DPA for teachers, nurses, first responders, community hero programs.", headlineHint: "DPA for Heroes" },
      { key: "dpa_credit_score", brief: "Minimum credit considerations for most local DPA programs.", headlineHint: "Credit and DPA" },
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
