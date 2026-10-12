// Small tab bar for pages that hold two closely related views (Checklists +
// trade assignments, Observations + corrective actions), so related records
// live behind one sidebar entry instead of two.

export function SectionTabs<T extends string>({ tabs, value, onChange }: {
  tabs: { key: T; label: string; count?: number }[];
  value: T;
  onChange: (key: T) => void;
}) {
  return (
    <div className="px-4 sm:px-7 pt-5">
      <div className="inline-flex gap-1 p-1 rounded-lg border border-[#222A35] bg-[#11161D]">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => onChange(t.key)}
            className={`h-8 px-3.5 rounded-md text-[12px] flex items-center gap-1.5 transition ${value === t.key ? "bg-[#FF6B1A] text-white" : "text-[#8A95A5] hover:text-white"}`}
          >
            {t.label}
            {t.count ? <span className={`text-[10px] px-1.5 rounded-full ${value === t.key ? "bg-white/20" : "bg-[#222A35]"}`}>{t.count}</span> : null}
          </button>
        ))}
      </div>
    </div>
  );
}
