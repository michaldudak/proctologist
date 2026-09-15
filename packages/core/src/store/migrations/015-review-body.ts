/**
 * A review draft becomes the Markdown the agent wrote, in whatever shape the repository's own
 * instructions or skill asked for, instead of a list of findings the app laid out itself. The
 * drafts already kept are rendered into the new column much as the app used to render them, one
 * bullet per finding in the order they came, so nothing already drafted goes missing. Nothing
 * else reads the old column, so it goes rather than being carried along empty.
 */
export const sql = `
ALTER TABLE review_drafts ADD COLUMN body TEXT NOT NULL DEFAULT '';

UPDATE review_drafts SET body = COALESCE(
	(
		SELECT group_concat(
			'- **' || json_extract(finding.value, '$.title') || '**'
				|| CASE
					WHEN json_extract(finding.value, '$.severity') IS NULL THEN ''
					ELSE ' (' || json_extract(finding.value, '$.severity') || ')'
				END
				|| CASE
					WHEN json_extract(finding.value, '$.path') IS NULL THEN ''
					ELSE ' — \`' || json_extract(finding.value, '$.path')
						|| CASE
							WHEN json_extract(finding.value, '$.line') IS NULL THEN ''
							ELSE ':' || json_extract(finding.value, '$.line')
						END
						|| '\`'
				END
				|| char(10) || '  ' || json_extract(finding.value, '$.body'),
			char(10) || char(10)
			ORDER BY finding.key
		)
		FROM json_each(review_drafts.findings) AS finding
	),
	''
);

ALTER TABLE review_drafts DROP COLUMN findings;
`;
