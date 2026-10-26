type StepIllustrationProps = { step: 1 | 2 | 3; className?: string };

export default function StepIllustration({ step, className }: StepIllustrationProps) {
  return <svg className={className} viewBox="0 0 240 116" aria-hidden="true" focusable="false" fill="none">
    <ellipse cx="120" cy="104" rx="84" ry="8" fill="var(--brand-emerald-soft)" />
    {step === 1 && <>
      <rect x="48" y="16" width="142" height="82" rx="12" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" />
      <path d="M49 37h140" stroke="var(--border-normal)" strokeWidth="2" /><circle cx="60" cy="27" r="3" fill="var(--color-accent)" /><circle cx="71" cy="27" r="3" fill="var(--color-primary)" />
      {[62, 101, 140].map(x => <g key={x}><rect x={x} y="49" width="30" height="28" rx="5" fill="var(--brand-emerald-soft)" /><path d={`M${x + 5} 70l7-9 5 5 5-5 5 9`} stroke="var(--color-primary)" strokeWidth="2" strokeLinejoin="round" /><path d={`M${x + 3} 86h24`} stroke="var(--border-strong)" strokeWidth="3" strokeLinecap="round" /></g>)}
      <circle cx="191" cy="35" r="20" fill="var(--color-accent)" /><path d="M191 45V25m-7 7 7-7 7 7" stroke="var(--color-on-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </>}
    {step === 2 && <>
      <rect x="73" y="8" width="63" height="96" rx="12" fill="var(--surface-raised)" stroke="var(--color-primary)" strokeWidth="2" />
      <path d="M92 17h25M98 96h13" stroke="var(--border-strong)" strokeWidth="3" strokeLinecap="round" />
      <rect x="83" y="33" width="43" height="37" rx="6" fill="var(--brand-emerald-soft)" /><path d="M94 49h21m-7-7 7 7-7 7" stroke="var(--color-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M142 49h20m0 0-6-6m6 6-6 6" stroke="var(--color-accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="165" y="26" width="38" height="38" rx="12" fill="var(--color-primary)" /><path d="M176 40h16v10h-9l-4 4v-4h-3z" stroke="var(--color-on-primary)" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="43" cy="67" r="13" fill="var(--color-accent)" /><path d="m38 67 4 4 6-8" stroke="var(--color-on-primary)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </>}
    {step === 3 && <>
      <path d="M54 22h97a10 10 0 0 1 10 10v42a10 10 0 0 1-10 10H91L71 99V84H54a10 10 0 0 1-10-10V32a10 10 0 0 1 10-10z" fill="var(--color-primary)" />
      <path d="m62 45 5 5 9-11m-14 27 5 5 9-11M87 45h48M87 66h33" stroke="var(--color-on-primary)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M153 42h30l15 15v42h-45z" fill="var(--surface-raised)" stroke="var(--border-strong)" strokeWidth="2" strokeLinejoin="round" /><path d="M183 42v15h15" stroke="var(--border-strong)" strokeWidth="2" />
      <rect x="146" y="67" width="46" height="20" rx="5" fill="var(--color-accent)" /><text x="169" y="81" textAnchor="middle" fill="var(--color-on-primary)" fontSize="11" fontWeight="700">PDF</text>
    </>}
  </svg>;
}
