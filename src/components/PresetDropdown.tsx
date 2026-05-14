import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';

interface PresetDropdownProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  presets: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  onSelect: (item: any) => void;
  onDelete: (index: number) => void;
  defaultText: string;
  disabled?: boolean;
  isPlp?: boolean;
}

export function PresetDropdown({
  presets,
  onSelect,
  onDelete,
  defaultText,
  disabled = false,
  isPlp = false,
}: PresetDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => {
          if (!disabled) setIsOpen(!isOpen);
        }}
        className={`w-full bg-white/5 border border-white/10 rounded px-3 py-2 text-xs font-mono text-blue-400 focus:outline-none focus:border-blue-500 flex justify-between items-center transition-colors ${
          disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:bg-white/10'
        }`}
      >
        <span className="truncate pr-2">{defaultText}</span>
        <span className="text-[10px] text-white/40">▼</span>
      </button>
      {isOpen && (
        <div className="absolute top-full left-0 w-full mt-1 bg-zinc-900 border border-white/10 rounded overflow-hidden z-[60] shadow-xl">
          <div className="max-h-48 overflow-y-auto custom-scrollbar">
            {presets.length === 0 ? (
              <div className="p-3 text-[10px] text-white/30 italic text-center">No presets saved</div>
            ) : (
              presets.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 hover:bg-white/10 group cursor-pointer transition-colors border-b border-white/5 last:border-0"
                  onClick={() => {
                    onSelect(item);
                    setIsOpen(false);
                  }}
                >
                  <span className="font-mono text-blue-400 hover:text-blue-300 text-[10px] truncate max-w-[80%]">
                    {item.name}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(idx);
                    }}
                    className="flex justify-center items-center p-1 bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white rounded opacity-40 group-hover:opacity-100 transition-all focus:opacity-100 h-6 w-6"
                    title={isPlp ? 'Delete PLP Preset' : 'Delete Preset'}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
