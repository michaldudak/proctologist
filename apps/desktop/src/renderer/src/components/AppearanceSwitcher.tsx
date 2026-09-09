import { DesktopIcon, MoonIcon, SunIcon, type Icon } from "@phosphor-icons/react";
import type { AppearanceMode } from "../../../shared/ipc.js";

const CHOICES: { mode: AppearanceMode; icon: Icon; label: string }[] = [
	{ mode: "system", icon: DesktopIcon, label: "System" },
	{ mode: "light", icon: SunIcon, label: "Light" },
	{ mode: "dark", icon: MoonIcon, label: "Dark" },
];

interface AppearanceSwitcherProps {
	mode: AppearanceMode;
	onChange: (mode: AppearanceMode) => void;
}

/** Three states rather than a switch: "follow the system" is a choice, not the absence of one. */
export function AppearanceSwitcher({ mode, onChange }: AppearanceSwitcherProps): React.JSX.Element {
	return (
		<div className="segmented" role="group" aria-label="Appearance">
			{CHOICES.map((choice) => (
				<button
					key={choice.mode}
					type="button"
					className="segment"
					aria-pressed={choice.mode === mode}
					onClick={() => onChange(choice.mode)}
				>
					<choice.icon size={14} weight="bold" aria-hidden />
					{choice.label}
				</button>
			))}
		</div>
	);
}
