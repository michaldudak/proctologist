import { DesktopIcon, MoonIcon, SunIcon, type Icon } from "@phosphor-icons/react";
import { useAppearance } from "../state/useAppearance.js";
import { Tooltip } from "./Tooltip.js";
import type { AppearanceMode } from "../../../shared/ipc.js";

const CHOICES: { mode: AppearanceMode; icon: Icon; label: string }[] = [
	{ mode: "system", icon: DesktopIcon, label: "Follow the system" },
	{ mode: "light", icon: SunIcon, label: "Light" },
	{ mode: "dark", icon: MoonIcon, label: "Dark" },
];

/** Three states rather than a switch: "follow the system" is a choice, not the absence of one. */
export function AppearanceSwitcher(): React.JSX.Element {
	const [mode, choose] = useAppearance();

	return (
		<div className="segmented" role="group" aria-label="Appearance">
			{CHOICES.map((choice) => (
				<Tooltip
					key={choice.mode}
					content={choice.label}
					render={
						<button
							type="button"
							className="segment"
							aria-pressed={choice.mode === mode}
							onClick={() => choose(choice.mode)}
						/>
					}
				>
					<choice.icon size={14} weight="bold" aria-hidden />
					<span className="visually-hidden">{choice.label}</span>
				</Tooltip>
			))}
		</div>
	);
}
