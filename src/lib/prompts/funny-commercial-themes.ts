// Funny Commercial — Scene 1 theme library.
//
// Each theme is a comedic premise. Within a theme there are 6–10 visual
// realizations. Claude picks one theme per ad and one visual within
// that theme; conceptKey returned is "<themeKey>:<visualKey>". Same
// pattern as AI_POSTER_THEMES — themes give variety by structure so
// you don't see the same elephant-in-apartment three batches in a row.
//
// The setup-payoff for these ads is fixed by the 4-scene template:
// Scene 1 is the absurd premise, Scene 2 cuts to a person lying awake
// in bed listening to muffled noises, then a CTA, then logo. So Scene
// 1's job is to be loud, weird, and "what the hell is going on next
// door" — anything that would plausibly disturb an apartment neighbor.

import type { FcTheme } from "../types";

export const FUNNY_COMMERCIAL_THEMES: FcTheme[] = [
  {
    key: "apartment_animal",
    premise:
      "An animal living a quiet human life in a tiny apartment, doing something rhythmic and noisy that a sleeping neighbor would absolutely hear through the wall.",
    tone: "deadpan absurd, like a wildlife documentary about a nightclub",
    visuals: [
      {
        key: "elephant_dance",
        seed: "an Asian elephant in a tiny dimly lit studio apartment doing slick footwork dance moves on a worn hardwood floor at night, single warm desk lamp casting long shadows, refrigerator hum, photorealistic, the elephant is mid-spin with one foot raised, cinematic atmosphere",
      },
      {
        key: "moose_drums",
        seed: "a full-sized moose seated at a small drum kit in a cramped studio apartment at night, mid-fill with both antlers gently shaking, single warm pendant lamp overhead, dust motes catching the light, photorealistic, deadpan composition",
      },
      {
        key: "giraffe_treadmill",
        seed: "an adult giraffe running on a small home treadmill in a tiny apartment at night, neck bent down to fit under the ceiling, sweat towel draped over the bannister of a stair railing, dim lamp, photorealistic, dynamic motion blur on the legs",
      },
      {
        key: "ostrich_yoga",
        seed: "a large ostrich in stretchy workout leggings doing a downward dog yoga pose on a small foam mat in a tiny apartment living room at night, single floor lamp, plant in the corner, photorealistic, deadpan composition",
      },
      {
        key: "bear_cooking",
        seed: "a brown bear standing at a tiny apartment stovetop violently shaking a frying pan that is on fire, kitchen towel slung over its shoulder, late-night kitchen lighting, smoke pouring out, photorealistic, dynamic, the pan is mid-toss",
      },
      {
        key: "kangaroo_bouncing",
        seed: "a large kangaroo bouncing on a small trampoline in a tiny apartment living room at night, head nearly hitting the ceiling each bounce, single warm desk lamp, photorealistic, motion blur on tail",
      },
      {
        key: "sloth_party",
        seed: "a sloth slowly DJing on a small apartment-sized DJ controller at night, disco ball spinning above casting colored light, photorealistic, dramatic moody lighting, the sloth is mid-headphone-press",
      },
      {
        key: "octopus_drums",
        seed: "a large octopus seated at a drum kit in a small apartment at night, all eight tentacles holding drumsticks and mid-strike across cymbals and toms simultaneously, dramatic single overhead light, photorealistic, dynamic",
      },
    ],
  },
  {
    key: "wrong_scale",
    premise:
      "Something tiny doing something massive, or something massive crammed into something tiny — the comedy comes from a violent mismatch of scale that would absolutely shake the building.",
    tone: "matter-of-fact, like the photographer didn't notice the absurdity",
    visuals: [
      {
        key: "monster_truck_kitchen",
        seed: "a full-sized monster truck with massive tires squeezed into a small apartment kitchen, engine running, exhaust visible, photorealistic, dramatic lighting from a single overhead bulb, the truck is wedged at an angle between counters",
      },
      {
        key: "tiny_construction",
        seed: "a tiny construction crew of mice in safety vests operating actual mouse-sized jackhammers and drills on the floor of an apartment hallway at night, sparks flying, photorealistic, macro shot",
      },
      {
        key: "blue_whale_bath",
        seed: "a full-grown blue whale crammed into a tiny apartment bathroom bathtub, water sloshing over the sides, single bare bulb overhead, photorealistic, surreal cinematic composition",
      },
      {
        key: "rocket_engine_bedroom",
        seed: "a real rocket engine being test-fired in a small apartment bedroom at night, blue flame jetting across the room past a normal bed, walls glowing from the heat, photorealistic, dramatic, dust and papers flying",
      },
      {
        key: "marching_band_living_room",
        seed: "a full marching band in uniform crammed shoulder-to-shoulder into a tiny apartment living room at night mid-performance, brass instruments raised, drum major in the middle, photorealistic, single warm overhead lamp",
      },
      {
        key: "industrial_blender_apartment",
        seed: "a giant industrial restaurant blender three feet tall running on full power on the kitchen counter of a tiny apartment late at night, ingredients spraying out of the top, photorealistic, dramatic motion blur",
      },
      {
        key: "freight_train_hallway",
        seed: "a full-sized freight train locomotive squeezed down a narrow apartment hallway at night, headlight beam blasting forward, photorealistic, dramatic perspective, dust motes in the beam",
      },
    ],
  },
  {
    key: "object_acting_human",
    premise:
      "A regular household object behaving like a person doing a noisy hobby. The object is treated with photographic dignity — the absurdity is in the unexplained agency.",
    tone: "documentary, like the photographer believes this is normal",
    visuals: [
      {
        key: "vacuum_dancing",
        seed: "an upright vacuum cleaner standing in the middle of an apartment living room at night doing a slow tango with a floor lamp, both leaning into the dip, photorealistic, single warm side light, slightly surreal",
      },
      {
        key: "fridge_workout",
        seed: "a household refrigerator doing pushups on the floor of a tiny apartment kitchen at night, doors flapping open and closed with each rep, photorealistic, dramatic, single overhead light",
      },
      {
        key: "blender_bowling",
        seed: "a kitchen blender bowling a strike down a polished apartment hallway at night, pins set up at the far end mid-collapse, photorealistic, dramatic perspective, dynamic motion",
      },
      {
        key: "lamp_karaoke",
        seed: "a tall standing floor lamp holding a microphone in front of its lampshade-face singing karaoke in a tiny apartment living room at night, lampshade tilted dramatically back, photorealistic, soft warm lighting from itself",
      },
      {
        key: "toaster_band",
        seed: "a four-slice toaster, a coffee maker, a microwave, and a stand mixer arranged as a four-piece rock band on an apartment kitchen counter mid-performance at night, photorealistic, single warm overhead light, dynamic composition",
      },
      {
        key: "broom_skateboard",
        seed: "a broom standing upright on a skateboard mid-kickflip down an apartment hallway at night, photorealistic, motion blur, single warm sconce light",
      },
      {
        key: "couch_jumping",
        seed: "a three-cushion sofa jumping rope on its own in the middle of a tiny apartment living room at night, photorealistic, dynamic motion, single floor lamp lighting",
      },
    ],
  },
  {
    key: "extreme_diy",
    premise:
      "A person attempting an absurdly noisy or destructive home improvement project at midnight in a tiny apartment, completely unfazed by the time of day or the consequences for their neighbors.",
    tone: "earnest determination, like a how-to video at the wrong hour",
    visuals: [
      {
        key: "concrete_mixer",
        seed: "a man in pajamas operating a full-size concrete mixer in his tiny apartment living room at midnight, wet concrete pouring onto a tarp, photorealistic, single overhead light, dust in the air",
      },
      {
        key: "chainsaw_shelves",
        seed: "a woman in a robe using a gas-powered chainsaw to cut a board for a bookshelf in her tiny apartment living room at midnight, sawdust flying, photorealistic, single warm overhead light, dramatic",
      },
      {
        key: "tiling_2am",
        seed: "a man in pajamas crouched on the floor of his apartment kitchen at 2am cutting ceramic tile with a wet tile saw spraying water, photorealistic, single overhead light, focused expression",
      },
      {
        key: "drilling_wall",
        seed: "a man in pajamas with safety goggles drilling a massive hole into his apartment wall at midnight using an industrial hammer drill, dust pouring out, photorealistic, single overhead light, debris on the floor",
      },
      {
        key: "demolition",
        seed: "a woman in pajamas swinging a sledgehammer at her apartment kitchen wall at midnight, drywall debris frozen midair, photorealistic, single overhead light, dramatic dynamic motion",
      },
      {
        key: "welding_kitchen",
        seed: "a man in pajamas welding a metal frame on his apartment kitchen floor at midnight, brilliant blue welding sparks lighting the whole room, photorealistic, dramatic",
      },
    ],
  },
  {
    key: "unexpected_gathering",
    premise:
      "A surprise gathering of beings who absolutely should not be having a party in a tiny apartment at night — and they are doing so loudly.",
    tone: "deadpan, like a security cam caught a meeting that wasn't supposed to happen",
    visuals: [
      {
        key: "raccoon_poker",
        seed: "five raccoons in tiny visors playing a serious game of poker around a small kitchen table in an apartment at night, chips stacked, cards held in tiny paws, single overhead light, photorealistic, slight cigar smoke",
      },
      {
        key: "pigeon_meeting",
        seed: "twelve pigeons in tiny business suits gathered around an apartment dining table holding a serious board meeting at night, one pigeon at a flip chart, photorealistic, single overhead light",
      },
      {
        key: "frogs_choir",
        seed: "a choir of fifteen frogs of various sizes lined up in three rows on apartment living-room stairs at night, all mid-song mouths open, conductor frog with baton, photorealistic, single warm overhead light",
      },
      {
        key: "owls_gym",
        seed: "five owls doing aerobics in front of a TV in a tiny apartment living room at midnight, all wings spread mid-jumping-jack, photorealistic, single floor lamp",
      },
      {
        key: "cats_marching",
        seed: "twenty cats in formation marching in step around a tiny apartment living room at night carrying tiny instruments, photorealistic, single overhead light, dramatic composition",
      },
      {
        key: "squirrels_construction",
        seed: "a team of squirrels in safety vests assembling IKEA furniture on an apartment living room floor at 2am, tiny tools and instruction manual spread out, photorealistic, single overhead light",
      },
    ],
  },
  {
    key: "physics_breakdown",
    premise:
      "An ordinary nighttime activity in an apartment but physics has gone visibly wrong — gravity, scale, or motion behaves bizarrely. Loud and disruptive.",
    tone: "matter-of-fact surreal, like the laws of nature took the night off",
    visuals: [
      {
        key: "bouncing_furniture",
        seed: "every piece of furniture in a tiny apartment living room — couch, coffee table, lamp, TV — all bouncing two feet off the floor in unison at night as if invisible springs are firing, photorealistic, single overhead light, dynamic motion",
      },
      {
        key: "floating_dishes",
        seed: "a stack of dirty dishes floating two feet above the apartment kitchen sink at night, slowly rotating in midair, water dripping, photorealistic, single overhead light",
      },
      {
        key: "magnet_kitchen",
        seed: "every metal object in a tiny apartment kitchen — pots, pans, knives, forks — all flying through the air toward a single point near the ceiling at night, photorealistic, dramatic motion, single overhead light",
      },
      {
        key: "jellyfish_apartment",
        seed: "the entire apartment living room filled with floating jellyfish drifting through the air at night, the resident standing in pajamas in the middle, photorealistic, soft glow from the jellyfish, dreamlike",
      },
      {
        key: "raining_indoors",
        seed: "indoor rain pouring from the ceiling of a tiny apartment living room at night, the floor flooded ankle-deep, ceiling fan spinning in the rain, photorealistic, single overhead light catching the water",
      },
      {
        key: "spinning_room",
        seed: "the living room of a tiny apartment visibly tilted forty-five degrees with everything sliding toward one wall — couch mid-slide, lamp tipped, papers flying — at night, photorealistic, single overhead light",
      },
    ],
  },
];
