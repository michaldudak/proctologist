import type { SourceItem } from "@proctologist/core/browser";

/** Missing Items must remain removable, even after their Source has left the picker. */
export function TaskSuggestionLinks({
	items,
	itemIds,
	onChange,
}: {
	items: SourceItem[];
	itemIds: string[];
	onChange: (ids: string[]) => void;
}): React.JSX.Element {
	const missing = itemIds.filter((id) => !items.some((item) => item.id === id));
	return (
		<fieldset>
			<legend>Linked items</legend>
			{missing.length > 0 ? (
				<div>
					<p className="task-warning">
						{missing.length} linked {missing.length === 1 ? "item is" : "items are"} no longer in a
						tracked source. Remove the missing links to accept this suggestion.
					</p>
					<button
						type="button"
						onClick={() => onChange(itemIds.filter((id) => !missing.includes(id)))}
					>
						Remove missing links
					</button>
				</div>
			) : null}
			{items.map((item) => (
				<label key={item.id}>
					<span>
						<input
							type="checkbox"
							checked={itemIds.includes(item.id)}
							onChange={(event) =>
								onChange(
									event.target.checked
										? [...itemIds, item.id]
										: itemIds.filter((id) => id !== item.id),
								)
							}
						/>
						{item.locator} #{item.externalId} — {item.title}
					</span>
				</label>
			))}
		</fieldset>
	);
}
