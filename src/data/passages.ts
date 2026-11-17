import type { ReadingPassage } from '../types/gaze';

export const CURATED_PASSAGES: ReadingPassage[] = [
  {
    id: 'eye-movements-reading',
    title: 'How the Eye Navigates the Printed Line',
    subtitle: 'Saccades, fixations, and the perceptual span of skilled reading',
    author: 'Dr. Elena Vance',
    category: 'Cognitive Optics',
    year: '2026',
    paragraphs: [
      'When we read a page of prose, our subjective experience feels continuous and effortless, like gliding smoothly along a ribbon of ink. In reality, the human eye never glides during reading. Instead, it performs a rapid choreography of ballistic jumps called saccades, punctuated by brief moments of stillness known as fixations.',
      'During each fixation—typically lasting between two hundred and two hundred fifty milliseconds—the fovea extracts high-resolution visual detail from a narrow window of about seven to nine character spaces to the right of the gaze point. Beyond that sharp core, parafoveal vision previews word length and initial letters, guiding where the next jump should land.',
      'Roughly ten to fifteen percent of all reading eye movements are regressions: brief backward leaps to an earlier word or phrase. Regressions are not failures of attention; they are the visual system actively resolving syntactic ambiguity, verifying an unexpected turn of phrase, or recovering from an overshoot at a line break.',
      'By tracking iris vectors relative to eye-corner geometry and compensating for subtle head rotation, optical reading instruments reveal this hidden choreography in real time. Patterns of hesitation, deep concentration, and rapid skimming emerge directly from the geometry of dwell duration across every word on the page.'
    ]
  },
  {
    id: 'architecture-of-typography',
    title: 'The Quiet Architecture of Legible Measure',
    subtitle: 'Why line length, leading, and rhythm govern cognitive endurance',
    author: 'Marcus Lindqvist',
    category: 'Editorial Craft',
    year: '2025',
    paragraphs: [
      'Typography succeeds when it disappears. A well-proportioned column of text establishes an unspoken contract between the page and the reader’s oculomotor system: lines are neither so narrow that the eye grows exhausted from constant return sweeps, nor so wide that the reader loses track of which line comes next.',
      'Classical bookmakers discovered centuries ago through trial and craft what eye-tracking laboratories later confirmed empirically. A measure of roughly sixty-five characters per line minimizes the angular distance of return-sweep saccades while preserving enough horizontal context for peripheral word-shape recognition.',
      'Leading—the vertical breathing room between baselines—acts as a navigational guardrail. When line spacing tightens below one hundred thirty percent of the type size, descenders crowd ascenders and vertical gaze drift pulls the reader onto neighboring lines. Generous leading restores spatial clarity without slowing reading velocity.'
    ]
  },
  {
    id: 'history-of-ophthalmograph',
    title: 'From Mechanical Mirrors to Optical Landmarks',
    subtitle: 'A brief history of measuring where human attention rests',
    author: 'Sora Takahashi',
    category: 'Instrumentation',
    year: '2026',
    paragraphs: [
      'Early twentieth-century reading researchers faced an extraordinary experimental hurdle: how to record eye motion without touching the cornea. In 1935, the Ophthalmograph solved this by projecting a thin beam of light onto the cornea and capturing its reflection onto moving thirty-five-millimeter photographic film.',
      'Subjects sat braced against a rigid chin rest while reading short index cards illuminated by incandescent lamps. Developing a single strip of film took hours, and researchers measured saccade lengths with brass dividers and magnifying loupes under darkroom safelights.',
      'Modern computer vision replaces chin rests and silver-halide film with sub-millisecond facial landmark estimation. Four hundred seventy-eight anatomical coordinates—including ten dedicated iris points—turn an ordinary webcam into a non-invasive optical instrument capable of mapping attention across arbitrary digital pages.'
    ]
  },
  {
    id: 'slow-reading-manifesto',
    title: 'In Praise of the Unhurried Second Glance',
    subtitle: 'On deliberate attention, marginalia, and revisiting difficult sentences',
    author: 'Clara Moreau',
    category: 'Essays',
    year: '2024',
    paragraphs: [
      'Digital interfaces often celebrate speed above comprehension, promising summaries and skimmed bullet points in place of sustained thought. Yet the passages that alter how we see the world rarely surrender their meaning on the first rapid pass.',
      'True comprehension leaves an irregular trace. The eye slows over an unfamiliar metaphor, pauses at the hinge of an argument, and darts back two sentences to test whether a premise actually supports its conclusion. Those backward glances are the visible signature of active thinking.',
      'When we observe our own reading heatmaps afterward, the bright clusters around dense sentences remind us that friction is not a flaw in the text—it is the exact place where a new idea took root.'
    ]
  }
];

export interface TokenizedWord {
  index: number;
  text: string;
  cleanWord: string;
  paragraphIndex: number;
}

export function tokenizePassage(passage: ReadingPassage): {
  paragraphs: TokenizedWord[][];
  flatWords: TokenizedWord[];
} {
  const paragraphs: TokenizedWord[][] = [];
  const flatWords: TokenizedWord[] = [];
  let idx = 0;

  passage.paragraphs.forEach((para, pIdx) => {
    const tokens = para
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const paraWords: TokenizedWord[] = tokens.map((raw) => {
      const clean = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').toLowerCase();
      const item: TokenizedWord = {
        index: idx++,
        text: raw,
        cleanWord: clean || raw.toLowerCase(),
        paragraphIndex: pIdx,
      };
      flatWords.push(item);
      return item;
    });
    paragraphs.push(paraWords);
  });

  return { paragraphs, flatWords };
}
