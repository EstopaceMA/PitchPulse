/** Compact football mark shared by the library and match headers. */
export function FootballMark({ size = 22 }: { size?: number }) {
    return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.7" />
        <path d="m12 6.4 4.5 3.3-1.7 5.3H9.2l-1.7-5.3L12 6.4Z" fill="currentColor" />
        <path d="M12 6.4V2.5m4.5 7.2 3.7-1.2M14.8 15l2.3 3.6M9.2 15l-2.3 3.6M7.5 9.7 3.8 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>;
}
