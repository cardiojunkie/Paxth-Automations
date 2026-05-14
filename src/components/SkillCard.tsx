import React from 'react';
import { motion } from 'motion/react';

type CardType = 'blue' | 'green' | 'muted' | 'yellow';

interface SkillCardProps {
  title: string;
  tag: string;
  description: string;
  type: CardType;
  active?: boolean;
}

const typeMap: Record<CardType, string> = {
  blue: 'border-cyan-500 bg-cyan-950/20 text-cyan-400 shadow-[0_0_15px_rgba(6,182,212,0.1)]',
  green: 'border-emerald-500 bg-emerald-950/20 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]',
  muted: 'border-white/10 bg-white/5 opacity-60 text-white/40',
  yellow: 'border-amber-500 bg-amber-950/20 text-amber-400 shadow-[0_0_15px_rgba(245,158,11,0.1)]',
};

const indicatorMap: Record<CardType, string> = {
  blue: 'bg-cyan-400',
  green: 'bg-emerald-400',
  muted: 'bg-white/20',
  yellow: 'bg-amber-400',
};

export function SkillCard({ title, tag, description, type, active = false }: SkillCardProps) {
  return (
    <motion.div
      whileHover={{ x: 2, scale: 1.01 }}
      className={`relative p-3 border border-r-0 border-t-0 border-b-0 border-l-[3px] transition-all group overflow-hidden ${typeMap[type]}`}
    >
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff05_1px,transparent_1px),linear-gradient(to_bottom,#ffffff05_1px,transparent_1px)] bg-[size:4px_4px] [mask-image:radial-gradient(ellipse_100%_100%_at_50%_50%,#000_10%,transparent_80%)] pointer-events-none opacity-50 mix-blend-overlay" />

      <div className="relative flex justify-between items-start mb-2 z-10">
        <div className="flex items-center gap-2">
          <div
            className={`w-1.5 h-1.5 rounded-none ${active ? 'animate-pulse shadow-[0_0_8px_currentColor]' : 'opacity-60'} ${indicatorMap[type]}`}
            style={{ boxShadow: active ? '0 0 8px currentColor' : 'none' }}
          />
          <span className="text-[10px] uppercase tracking-[0.2em] font-bold font-mono text-white/90">{title}</span>
        </div>
        <span className="text-[8px] px-1.5 py-px uppercase tracking-[0.2em] border border-current font-bold bg-black/60">
          {tag}
        </span>
      </div>
      <p className="relative z-10 text-[9px] text-white/50 leading-relaxed font-mono uppercase tracking-tight">
        {description}
      </p>
    </motion.div>
  );
}
