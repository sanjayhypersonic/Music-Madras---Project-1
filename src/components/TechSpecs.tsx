import { Sliders, Mic, ShieldAlert, CheckCircle, Award, Volume2, Video } from 'lucide-react';
import { TECHNICAL_EQUIPMENT } from '../data';

export default function TechSpecs() {
  return (
    <section className="py-12 bg-zinc-950 border-t border-b border-zinc-800/85 px-4 md:px-8">
      <div className="max-w-7xl mx-auto space-y-10">
        
        {/* Section Header */}
        <div className="text-center max-w-2xl mx-auto space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-full text-[10px] font-extrabold tracking-wider uppercase">
            <Sliders className="w-3.5 h-3.5" />
            Studio Signal Chain
          </div>
          <h2 className="font-serif text-2xl md:text-3xl font-bold text-zinc-50">
            Our Acoustic Philosophy & Rig
          </h2>
          <p className="text-xs md:text-sm text-zinc-400 leading-relaxed">
            Live classical and sacred music features delicate acoustic transients—the deep resonance of cathedral pipe organs, the layered harmony of church choirs, and the sweet bowing of classical string ensembles. 
            Bulky camera rigs and over-processing completely squash these dynamics. Here is the custom studio-grade rig we deploy to keep live sound pristine:
          </p>
        </div>

        {/* Specs Columns */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {TECHNICAL_EQUIPMENT.map((categorySpec) => (
            <div
              key={categorySpec.category}
              className="bg-zinc-900/60 border border-zinc-800 p-6 rounded-2xl shadow-md space-y-4 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center gap-2 border-b border-zinc-800 pb-2.5">
                  {categorySpec.category === 'Microphones' ? (
                    <Mic className="w-4 h-4 text-amber-400" />
                  ) : categorySpec.category === 'Preamps & Converters' ? (
                    <Sliders className="w-4 h-4 text-[#0D9488]" />
                  ) : (
                    <Video className="w-4 h-4 text-rose-400" />
                  )}
                  <h3 className="font-serif text-sm font-bold text-zinc-100 uppercase tracking-wider">
                    {categorySpec.category}
                  </h3>
                </div>

                <div className="space-y-3.5 text-left">
                  {categorySpec.items.map((item) => (
                    <div key={item.name} className="space-y-1">
                      <h4 className="text-xs font-bold text-zinc-200">{item.name}</h4>
                      <p className="text-[11px] text-zinc-400 leading-normal">{item.purpose}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="pt-3 border-t border-zinc-800/60 text-[10px] text-zinc-500 font-semibold flex items-center gap-1">
                <CheckCircle className="w-3.5 h-3.5 text-[#0D9488]" />
                Professional Standard Calibrated
              </div>
            </div>
          ))}
        </div>

        {/* Educational Callout box on Sound Focus */}
        <div className="bg-zinc-900 text-zinc-100 p-6 md:p-8 rounded-3xl grid grid-cols-1 md:grid-cols-12 gap-6 items-center shadow-lg border border-zinc-850">
          <div className="md:col-span-8 space-y-3 text-left">
            <h3 className="font-serif text-xl md:text-2xl font-bold flex items-center gap-2 text-zinc-50">
              <Volume2 className="w-6 h-6 text-amber-400" />
              Why We Focus Heavily on Sound Over Camera Rigs
            </h3>
            <p className="text-xs md:text-sm text-zinc-300 leading-relaxed">
              In live classical performances, sound integrity is paramount. Heavy cinema cameras require loud cooling fans, massive mounting structures that distract the concert audience, and long intrusive setups. 
              By using high-grade, flagship mobile cameras mounted discreetly on silent stands, we shoot gorgeous 4K footage with single/multi-cam 4K capture in complete silence. 
              This lets us dedicate 100% of our energy to matching pre-amplifier gains, positioning premium condenser mics correctly, and preserving the natural resonance of Chennai's majestic halls.
            </p>
          </div>
          <div className="md:col-span-4 bg-zinc-950 p-4 rounded-2xl border border-zinc-800 space-y-2 text-left">
            <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Quick Comparison</h4>
            <div className="space-y-1.5 text-[11px] text-zinc-400">
              <p>📍 <strong>Traditional video:</strong> Muddy camera mic sound, weeks of delay.</p>
              <p>⚡ <strong>Music Madras:</strong> Studio sound, silent single/multi-cam 4K capture, 2-3 business days turn-around!</p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
