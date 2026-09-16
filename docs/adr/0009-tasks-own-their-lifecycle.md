# Tasks own their lifecycle independently of source Items

Tasks represent the user's commitments, while Items represent external work. Tasks have their own identity, title, stage and planning dates, and relate to Items many-to-many rather than being annotations on a single Item. This supports both standalone work and several actions derived from the same Item, without making a completed review mean that its PR must close.

External closure can complete a Task only through an opt-in rule on that Task, controlled by one explicitly chosen linked Item. Reopening the Item never reopens the Task; manually reopening the Task disables the rule. Automatic retention preserves linked Items, while explicit Source removal detaches affected links and rules but preserves Tasks. These choices prioritize stable user commitments over mirroring the external system's lifecycle.

The detailed behavior is recorded in [Sources and Tasks](../sources-and-tasks-design.md). The complete design was confirmed before implementation.
