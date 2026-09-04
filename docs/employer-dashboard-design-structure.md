# Employer dashboard: design observations and implementation structure

Reviewed 4 September 2026. Figma was inspected read-only. No design or application code was changed. Routes, component names, and API contracts below are proposals, not claims that these exist in Figma or the backend.

## Inspected design references

All links belong to the Hey HR file. Some frames use Huppr/Vita branding; choose the approved product name before implementation rather than mixing labels.

| Requested feature | Observed reference and structure |
| --- | --- |
| Employer Dashboard | [Organizational Dashboard](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=424-10547): persistent workspace navigation, greeting, summary cards, main widget column, secondary insights/status column. |
| Today's Activity Widget | In the dashboard: compact activity rows and a View all action. |
| View All Today's Activity | [Activity Timeline](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=418-5561): cards with timestamps and contextual actions; right-side search, category chips, date range, pending approval/document/interview counts, payroll notice. Categories shown: All, Recruitment, Employee, Payroll, Compliance, Events. |
| Company Calendar Widget | In the dashboard: compact week strip, selected day, event indicator/action, and View full calendar link. |
| View Full Calendar | [Company Calendar](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=495-4845): Day/Week/Month controls, New Event, summary cards, month grid, mini date picker, event-type filters, upcoming events. [Week variant](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=535-1810) uses timed columns. Day-view frames are present in the layer inventory; their exact layout was not inspected. |
| Create Calendar Event | [Create New Event](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=529-588): modal with title, event-type chips, start/end dates and times, location or link, Add Zoom, rich-text description, Cancel/Create Event. Types shown: Interview, Onboarding, Leave, Team Meeting, Public Holiday. |
| View Calendar Event | [Interview details](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=545-7651): title, date/time, edit/delete/close icons, description, related role, AI insight panel, location/link, organizer, attendee responses, Message Guests and Join Meeting. [Birthday variant](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=545-6732): employee profile, department, appreciation text, Celebrate action. Leave and onboarding detail variants are present but not individually inspected. |
| Department Overview / View All Department | [Departments Overview](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=498-10): total headcount, department and sub-team counts; New Department; grid/list control; department cards with icon, health/status, metrics, lead and drill-down. The repeated View All Department request is treated as one feature; a separate list-mode layout still needs inspection. |
| Department drill-down | [Engineering / Sub-teams](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=563-132): headcount, open requisitions, sub-team count, department lead, Role Directory/Sub-teams tabs, sort, Create Role/New Subteam, capacity cards. These are adjacent functionality, not automatically part of the initial build. |
| Company Setup – Create Department | [Organisation setup](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=146-1583): Step 2 of 4, preset department tiles, Add Custom, Back/Continue. Presets shown include HR, Finance, Sales, Marketing, Operations, Customer Support, Engineering, Product, Design, Legal and Administration. |
| Create Department | [Add Custom Department](https://www.figma.com/design/r9kOhrbd2ng8SLG1XtujtJ/Hey-HR?node-id=146-2050): name, selectable icon grid, Cancel/Add Department. This modal was verified in onboarding; a separate post-onboarding New Department form has not yet been verified. Reusing its fields is a proposal. |

## Proposed frontend structure

```text
EmployerWorkspaceLayout
  WorkspaceHeader + WorkspaceSidebar
  /employer/dashboard
    DashboardSummary
    TodayActivityWidget
    CompanyCalendarWidget
    DepartmentOverviewWidget
  /employer/activities
    ActivityTimeline + ActivityFilters + ActivitySummary
  /employer/calendar
    CalendarToolbar + CalendarSummary
    CalendarMonthView / CalendarWeekView / CalendarDayView
    CalendarFilters + UpcomingEvents
    CreateEventDialog
    EventDetailsDialog (content varies by event kind)
  /employer/departments
    DepartmentSummary + DepartmentGrid / DepartmentList
    CreateDepartmentDialog
  /employer/departments/:departmentId
    DepartmentHeader + RoleDirectory / Subteams
  /employer/onboarding/departments
    DepartmentPresetPicker + CustomDepartmentDialog
```

Widgets and full pages should share query/data types and item components. Preserve selected dates and filters in URL query parameters. Open event dialogs using an event identifier so reload/back navigation is predictable. Clicking View all from Today's Activity should initially preserve today's date filter; the full timeline can then broaden it.

Keep draft department selection distinct from creating a live department. Share the name/icon form, but use different submit handlers and success behavior. During onboarding, adding a custom item updates the draft; it must not independently create an active organization department.

## Proposed backend boundaries and contracts

Every query and mutation must resolve the authenticated user's organization membership and relevant permission. A global employer role alone is insufficient for access to another company's records.

| Module | Proposed contract, under /api/v1 | Purpose |
| --- | --- | --- |
| Dashboard | GET /employer/dashboard | Bounded previews and summary counts, asOf timestamp and organization timezone. Avoid loading full histories. |
| Activities | GET /employer/activities?from=&to=&category=&search=&cursor= | Paginated timeline; action metadata must reflect current permissions and record state. |
| Calendar | GET /employer/calendar/events?from=&to=&types= | Events intersecting the requested date range, including multi-day events. |
| Calendar | POST /employer/calendar/events | Create an authorized manual event. |
| Calendar | GET/PATCH/DELETE /employer/calendar/events/:id | Details and permitted edits/deletion. Domain-generated events follow their source workflow. |
| Departments | GET/POST /employer/departments | List/filter departments or create one in an existing organization. |
| Departments | GET /employer/departments/:id | Department metrics and details. Add deeper role/sub-team APIs only when in scope. |

Core data shapes:

- Activity: id, organizationId, kind/category, occurredAt, title, summary, actor/subject reference, source entity, urgency, available actions. Leave approval must call the leave workflow; the feed is not an alternative approval authority.
- Calendar event: id, organizationId, kind, source/sourceId, title, start/end, timezone, allDay, description, location/join URL, organizer, attendees and response status. Keep birthday/leave/onboarding source references so edits do not diverge from the source record.
- Department: id, organizationId, name, iconId, description, lead reference; metrics should be computed from source data. Health, capacity and attendance require agreed definitions and reporting periods before implementation.

Calendar summary cards show pending interviews, work anniversaries, on-leave-today and performance reviews. Do not assume all four represent the selected date range: document each metric's period explicitly.

## Existing backend alignment

Verified locally:

- PUT /api/v1/employer/onboarding/departments replaces the department draft.
- POST /api/v1/employer/onboarding/departments/complete completes that step.
- GET /api/v1/reference/department-icons supplies active icons.
- Department draft DTO already supports clientId, name, optional iconId and description, plus expectedRevision. Names are trimmed/normalized and limited to 2–60 characters; the draft allows 1–20 departments.

Reuse these existing onboarding contracts. Migration `0007_employer_dashboard.sql` and the `employer-workspace` NestJS module now implement the dashboard, live department, activity and calendar contracts above. Employee-directory, recruiting, leave, payroll and performance source modules are still absent, so their derived metrics are returned as unavailable instead of fabricated.

## Implementation requirements and remaining design checks

- Provide loading, empty, error/retry, permission-denied and mutation-in-progress states; these were not all visible in the inspected frames.
- Validate event end after start, timezone handling, duplicate department names and active icon references. Sanitize description formatting and validate external meeting links.
- Define whether Add Zoom generates a meeting or merely accepts a link. Likewise, Message Guests, Celebrate and AI panels need explicit product behavior and integrations; a visual button is not an implemented service.
- Distinguish permission-based event editing from view-only source events; confirm delete behavior before implementation.
- Inspect exact day view, list-mode departments, leave/onboarding detail states, post-onboarding department creation and responsive layouts before claiming pixel-level coverage.
- Suggested build order: shared workspace shell and department forms; live departments; calendar list/create/details; activity aggregation; dashboard composition. Keep role/sub-team management, AI generation and external integrations as explicit additional scope.
