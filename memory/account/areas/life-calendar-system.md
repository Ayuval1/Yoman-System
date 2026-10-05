---
name: life-calendar-system
description: Large project to build a calendar system managing all of Yuval's personal and business life
sources: [chat]
aliases: []
---
- [stated] Planning a large calendar-system project intended to manage his entire personal and business calendar
- [stated] First data component: a school schedule structure file (period/break durations, constant every school day) built as input data for this project
- [stated] Second data component: a subjects/teachers/level/class list file, extracted from a school study-group assignment document
- [stated] Built a dedicated Claude project ("מסמכי בית ספר → קבצי מידע") that converts uploaded school documents (schedule structure, subjects/teachers, future day-based timetable) into standardized MD data files feeding this system
- [stated] New versions of a data file (e.g. new semester) are saved as separate files, never overwritten
- [stated] Cross-referencing multiple data files into one only happens on explicit request, never automatically
- [stated] Project also maintains a data-file registry (מאגר-קבצי-מידע.md) updated on every new file; readiness for a known cross-reference is detected automatically from the registry and raised in chat, but building the merge always still requires explicit approval
