import type { Lang, Level, State } from './config.js'

const en = {
  defaultTitle: 'Service disruption',
  severity: {
    1: { name: 'Critical', hint: 'Customers cannot use a core feature' },
    2: { name: 'Major', hint: 'A core feature is degraded for many customers' },
    3: { name: 'Minor', hint: 'Limited impact, or there is a workaround' },
    4: { name: 'Low', hint: 'No customer impact yet' },
  } as Record<Level, { name: string; hint: string }>,
  state: {
    investigating: 'Investigating',
    identified: 'Identified',
    monitoring: 'Monitoring',
    resolved: 'Resolved',
  } as Record<State, string>,
  defaultUpdate: {
    investigating: 'We are investigating this issue.',
    identified: 'We have found the cause and are working on a fix.',
    monitoring: 'A fix is in place and we are watching the results.',
    resolved: 'This incident has been resolved.',
  } as Record<State, string>,
  service: {
    operational: 'Operational',
    degraded: 'Degraded performance',
    partial: 'Partial outage',
    major: 'Major outage',
    monitoring: 'Recovering',
  },
  overall: {
    operational: 'All systems operational',
    degraded: 'Some systems are degraded',
    partial: 'Partial outage',
    major: 'Major outage',
    monitoring: 'Recovering from an incident',
  },
  page: {
    active: 'Active incidents',
    services: 'Services',
    history: 'Past incidents',
    noHistory: 'No incidents in the last 90 days.',
    daysAgo: '90 days ago',
    today: 'Today',
    incidentFree: (pct: string) => `${pct} without a major incident`,
    affects: 'Affects',
    resolvedIn: (d: string) => `Resolved in ${d}`,
    ongoingFor: (d: string) => `Ongoing for ${d}`,
    updated: 'Last updated',
    subscribe: 'Subscribe',
    feed: 'Atom feed',
    json: 'status.json',
    back: 'All services',
    poweredBy: 'Powered by',
    language: 'ภาษาไทย',
    noIncidentDay: 'No incidents',
  },
  block: {
    commander: 'Commander',
    services: 'Services',
    declared: 'Declared',
    impact: 'Impact started',
    acknowledged: 'Acknowledged',
    resolved: 'Resolved',
    lastUpdate: 'Last public update',
    duration: 'Duration',
    notYet: 'not yet',
    none: 'none',
    timeline: 'Timeline',
    links: 'Links',
    unconfirmed:
      'Reported by someone outside the team. It stays off the status page and no one is notified until a team member runs a command, for example `/ack`.',
    commands:
      'Commands: `/status investigating|identified|monitoring|resolved` · `/sev 1-4` · `/update <public message>` · `/note <internal note>` · `/title <public title>` · `/services <ids>` · `/assign @user` · `/link <url> [title]` · `/ack` · `/help`',
    asOf: 'as of',
    ongoing: 'ongoing',
    after: 'after',
  },
  timeline: {
    declared: (sev: string) => `declared the incident (${sev})`,
    status: (s: string) => `changed the status to ${s}`,
    severity: (sev: string) => `changed the severity to ${sev}`,
    update: 'posted a public update',
    note: 'noted',
    title: 'set the public title',
    services: 'set the affected services',
    assign: (u: string) => `made @${u} the commander`,
    link: 'added a link',
    ack: 'acknowledged',
  },
  help: `**incident-kit commands**

| Command | What it does |
| --- | --- |
| \`/status investigating\` \`identified\` \`monitoring\` \`resolved\` | Move the incident to a new state. \`/resolve\` is a shortcut |
| \`/sev 2\` | Change the severity (1 is the worst) |
| \`/update <message>\` | Post a public update. It goes to the status page and to notifications |
| \`/note <message>\` | Add an internal note to the timeline |
| \`/title <text>\` | Change the title shown on the status page |
| \`/services api payments\` | Set the affected services (ids from incident-kit.yml) |
| \`/assign @user\` | Hand over the incident commander role |
| \`/link <url> [title]\` | Attach a dashboard, log search or pull request |
| \`/ack\` | Acknowledge without changing anything |

Commands have to start a line. Several commands in one comment are fine. Only people with write access can run them.`,
  errors: (list: string[]) => `I could not run part of that comment:\n\n${list.map((e) => `- ${e}`).join('\n')}`,
  reminder: (who: string, minutes: number, sev: string) =>
    `${who} this ${sev} incident has had no public update for ${minutes} minutes. Customers are watching the status page. Post one with \`/update <message>\`, even if it is only "still investigating".`,
  resolvedSummary: (d: { duration: string; tta?: string; postmortem?: string }) =>
    `**Resolved.** Duration ${d.duration}${d.tta ? `, acknowledged after ${d.tta}` : ''}.${d.postmortem ? `\n\nA postmortem draft is ready for review: ${d.postmortem}` : ''}`,
  postmortemFailed:
    'I could not open the postmortem pull request. Allow GitHub Actions to create pull requests (Settings > Actions > General > Workflow permissions), or copy the draft below into a file.',
  closedEvent: 'The issue was closed, so the incident is now resolved.',
  reopenedEvent: 'The issue was reopened, so the incident is investigating again.',
  notify: {
    declared: (sev: string) => `New ${sev} incident`,
    severity: (sev: string) => `Severity changed to ${sev}`,
    status: (s: string) => `Status: ${s}`,
    update: 'Update',
    resolved: 'Resolved',
    commander: 'Commander',
    services: 'Services',
    open: 'Open incident',
  },
  postmortem: {
    title: (n: number, t: string) => `Postmortem: ${t} (#${n})`,
    intro:
      'This is a blameless review. It is about how our systems and processes allowed this to happen, not about who made a mistake. Fill in the sections marked TODO, then ask the people listed below to review.',
    summary: 'Summary',
    impact: 'Impact',
    window: 'Impact window',
    detected: 'Declared',
    acknowledged: 'Acknowledged',
    resolved: 'Resolved',
    duration: 'Duration',
    severity: 'Severity',
    services: 'Services',
    commander: 'Incident commander',
    participants: 'People involved',
    timeline: 'Timeline',
    time: 'Time',
    who: 'Who',
    what: 'What happened',
    rootCause: 'Root cause',
    wentWell: 'What went well',
    wentWrong: 'What went wrong',
    lucky: 'Where we got lucky',
    actions: 'Action items',
    actionHead: '| Action | Owner | Due | Issue |',
    todoImpact: 'TODO: who was affected, how many, and what they could not do.',
    todoCause: 'TODO: the chain of causes. Ask "why" until you reach something we can change.',
    pr: (n: number) => `Postmortem draft for #${n}. Generated from the incident timeline; edit freely.`,
  },
  report: {
    title: 'Incident report',
    period: 'Period',
    total: 'Incidents',
    mtta: 'Mean time to acknowledge',
    mttr: 'Mean time to resolve',
    median: 'median',
    bySeverity: 'By severity',
    byService: 'By service',
    byMonth: 'By month',
    month: 'Month',
    list: 'Incidents',
    open: 'still open',
    none: 'No incidents in this period.',
  },
}

export type Strings = typeof en

const th: Strings = {
  defaultTitle: 'บริการขัดข้อง',
  severity: {
    1: { name: 'วิกฤต', hint: 'ลูกค้าใช้งานฟีเจอร์หลักไม่ได้' },
    2: { name: 'รุนแรง', hint: 'ฟีเจอร์หลักทำงานผิดปกติกับลูกค้าจำนวนมาก' },
    3: { name: 'เล็กน้อย', hint: 'กระทบบางส่วน หรือมีทางเลี่ยง' },
    4: { name: 'ต่ำ', hint: 'ยังไม่กระทบลูกค้า' },
  },
  state: {
    investigating: 'กำลังตรวจสอบ',
    identified: 'พบสาเหตุแล้ว',
    monitoring: 'กำลังติดตามผล',
    resolved: 'แก้ไขแล้ว',
  },
  defaultUpdate: {
    investigating: 'ทีมกำลังตรวจสอบปัญหานี้อยู่',
    identified: 'พบสาเหตุแล้ว ทีมกำลังแก้ไข',
    monitoring: 'แก้ไขแล้ว ทีมกำลังติดตามผล',
    resolved: 'เหตุขัดข้องนี้ได้รับการแก้ไขแล้ว',
  },
  service: {
    operational: 'ใช้งานได้ปกติ',
    degraded: 'ทำงานช้ากว่าปกติ',
    partial: 'ขัดข้องบางส่วน',
    major: 'ขัดข้อง',
    monitoring: 'กำลังกลับสู่ปกติ',
  },
  overall: {
    operational: 'ทุกระบบใช้งานได้ปกติ',
    degraded: 'บางระบบทำงานช้ากว่าปกติ',
    partial: 'บางระบบขัดข้อง',
    major: 'ระบบขัดข้อง',
    monitoring: 'กำลังกลับสู่ปกติหลังเหตุขัดข้อง',
  },
  page: {
    active: 'เหตุขัดข้องที่กำลังเกิดขึ้น',
    services: 'บริการ',
    history: 'เหตุขัดข้องที่ผ่านมา',
    noHistory: 'ไม่มีเหตุขัดข้องในช่วง 90 วันที่ผ่านมา',
    daysAgo: '90 วันก่อน',
    today: 'วันนี้',
    incidentFree: (pct: string) => `ไม่มีเหตุขัดข้องร้ายแรง ${pct} ของเวลา`,
    affects: 'กระทบ',
    resolvedIn: (d: string) => `แก้ไขภายใน ${d}`,
    ongoingFor: (d: string) => `เกิดขึ้นมาแล้ว ${d}`,
    updated: 'อัปเดตล่าสุด',
    subscribe: 'ติดตาม',
    feed: 'Atom feed',
    json: 'status.json',
    back: 'ดูทุกบริการ',
    poweredBy: 'ทำงานด้วย',
    language: 'English',
    noIncidentDay: 'ไม่มีเหตุขัดข้อง',
  },
  block: {
    commander: 'ผู้ควบคุมเหตุการณ์',
    services: 'บริการ',
    declared: 'แจ้งเหตุเมื่อ',
    impact: 'ผลกระทบเริ่ม',
    acknowledged: 'รับเรื่องเมื่อ',
    resolved: 'แก้ไขเสร็จเมื่อ',
    lastUpdate: 'อัปเดตสาธารณะล่าสุด',
    duration: 'ระยะเวลา',
    notYet: 'ยังไม่มี',
    none: 'ไม่มี',
    timeline: 'ลำดับเหตุการณ์',
    links: 'ลิงก์',
    unconfirmed: 'แจ้งโดยคนนอกทีม จะยังไม่ขึ้นหน้าสถานะและไม่แจ้งเตือนใคร จนกว่าคนในทีมจะสั่งคำสั่งใดก็ได้ เช่น `/ack`',
    commands:
      'คำสั่ง: `/status investigating|identified|monitoring|resolved` · `/sev 1-4` · `/update <ข้อความสาธารณะ>` · `/note <บันทึกภายใน>` · `/title <หัวข้อสาธารณะ>` · `/services <id>` · `/assign @user` · `/link <url> [ชื่อ]` · `/ack` · `/help`',
    asOf: 'ณ เวลา',
    ongoing: 'ยังไม่จบ',
    after: 'หลังแจ้ง',
  },
  timeline: {
    declared: (sev: string) => `แจ้งเหตุ (${sev})`,
    status: (s: string) => `เปลี่ยนสถานะเป็น ${s}`,
    severity: (sev: string) => `เปลี่ยนความรุนแรงเป็น ${sev}`,
    update: 'โพสต์อัปเดตสาธารณะ',
    note: 'บันทึก',
    title: 'ตั้งหัวข้อบนหน้าสถานะ',
    services: 'ตั้งบริการที่ได้รับผลกระทบ',
    assign: (u: string) => `มอบหมายให้ @${u} เป็นผู้ควบคุมเหตุการณ์`,
    link: 'แนบลิงก์',
    ack: 'รับเรื่อง',
  },
  help: `**คำสั่งของ incident-kit**

| คำสั่ง | ใช้ทำอะไร |
| --- | --- |
| \`/status investigating\` \`identified\` \`monitoring\` \`resolved\` | เปลี่ยนสถานะเหตุการณ์ หรือพิมพ์ \`/resolve\` สั้น ๆ ก็ได้ |
| \`/sev 2\` | เปลี่ยนระดับความรุนแรง (1 คือรุนแรงที่สุด) |
| \`/update <ข้อความ>\` | โพสต์อัปเดตสาธารณะ ขึ้นหน้าสถานะและส่งแจ้งเตือน |
| \`/note <ข้อความ>\` | บันทึกภายในลงในลำดับเหตุการณ์ |
| \`/title <ข้อความ>\` | เปลี่ยนหัวข้อที่แสดงบนหน้าสถานะ |
| \`/services api payments\` | ตั้งบริการที่ได้รับผลกระทบ (ใช้ id จาก incident-kit.yml) |
| \`/assign @user\` | ส่งต่อบทบาทผู้ควบคุมเหตุการณ์ |
| \`/link <url> [ชื่อ]\` | แนบลิงก์ dashboard, log หรือ pull request |
| \`/ack\` | รับเรื่องโดยไม่เปลี่ยนอะไร |

คำสั่งต้องอยู่ต้นบรรทัด ใส่หลายคำสั่งในคอมเมนต์เดียวได้ และเฉพาะคนที่มีสิทธิ์เขียน repo เท่านั้นที่สั่งได้`,
  errors: (list: string[]) => `บางคำสั่งในคอมเมนต์นี้ทำไม่ได้:\n\n${list.map((e) => `- ${e}`).join('\n')}`,
  reminder: (who: string, minutes: number, sev: string) =>
    `${who} เหตุการณ์ ${sev} นี้ไม่มีอัปเดตสาธารณะมา ${minutes} นาทีแล้ว ลูกค้ากำลังดูหน้าสถานะอยู่ ช่วยโพสต์ด้วย \`/update <ข้อความ>\` แม้จะเป็นแค่ "ยังตรวจสอบอยู่" ก็ตาม`,
  resolvedSummary: (d) =>
    `**แก้ไขแล้ว** ใช้เวลาทั้งหมด ${d.duration}${d.tta ? ` รับเรื่องหลังแจ้ง ${d.tta}` : ''}${d.postmortem ? `\n\nร่าง postmortem พร้อมให้รีวิวแล้ว: ${d.postmortem}` : ''}`,
  postmortemFailed:
    'เปิด pull request ของ postmortem ไม่ได้ ให้เปิดสิทธิ์ให้ GitHub Actions สร้าง pull request ได้ (Settings > Actions > General > Workflow permissions) หรือคัดลอกร่างด้านล่างไปใส่ไฟล์เอง',
  closedEvent: 'issue ถูกปิด เหตุการณ์นี้จึงถือว่าแก้ไขแล้ว',
  reopenedEvent: 'issue ถูกเปิดอีกครั้ง เหตุการณ์นี้กลับไปเป็นกำลังตรวจสอบ',
  notify: {
    declared: (sev: string) => `เหตุขัดข้องใหม่ ${sev}`,
    severity: (sev: string) => `เปลี่ยนความรุนแรงเป็น ${sev}`,
    status: (s: string) => `สถานะ: ${s}`,
    update: 'อัปเดต',
    resolved: 'แก้ไขแล้ว',
    commander: 'ผู้ควบคุม',
    services: 'บริการ',
    open: 'เปิดดูเหตุการณ์',
  },
  postmortem: {
    title: (n: number, t: string) => `Postmortem: ${t} (#${n})`,
    intro:
      'เอกสารนี้เป็นการทบทวนแบบไม่หาคนผิด (blameless) ดูว่าระบบและกระบวนการของเราเปิดช่องให้เหตุนี้เกิดได้อย่างไร ไม่ใช่ใครทำพลาด เติมหัวข้อที่เขียนว่า TODO แล้วขอให้คนที่อยู่ในรายชื่อด้านล่างช่วยรีวิว',
    summary: 'สรุป',
    impact: 'ผลกระทบ',
    window: 'ช่วงเวลาที่กระทบ',
    detected: 'แจ้งเหตุ',
    acknowledged: 'รับเรื่อง',
    resolved: 'แก้ไขเสร็จ',
    duration: 'ระยะเวลา',
    severity: 'ความรุนแรง',
    services: 'บริการ',
    commander: 'ผู้ควบคุมเหตุการณ์',
    participants: 'คนที่เกี่ยวข้อง',
    timeline: 'ลำดับเหตุการณ์',
    time: 'เวลา',
    who: 'ใคร',
    what: 'เกิดอะไรขึ้น',
    rootCause: 'สาเหตุ',
    wentWell: 'สิ่งที่ทำได้ดี',
    wentWrong: 'สิ่งที่ยังไม่ดี',
    lucky: 'จุดที่เราโชคดี',
    actions: 'สิ่งที่ต้องทำต่อ',
    actionHead: '| งาน | ผู้รับผิดชอบ | กำหนดเสร็จ | Issue |',
    todoImpact: 'TODO: ใครได้รับผลกระทบ กี่คน และทำอะไรไม่ได้บ้าง',
    todoCause: 'TODO: ลำดับของสาเหตุ ถามว่า "ทำไม" ไปเรื่อย ๆ จนถึงสิ่งที่เราแก้ได้',
    pr: (n: number) => `ร่าง postmortem ของ #${n} สร้างจากลำดับเหตุการณ์ แก้ไขได้ตามสบาย`,
  },
  report: {
    title: 'รายงานเหตุขัดข้อง',
    period: 'ช่วงเวลา',
    total: 'จำนวนเหตุการณ์',
    mtta: 'เวลาเฉลี่ยกว่าจะรับเรื่อง',
    mttr: 'เวลาเฉลี่ยกว่าจะแก้ไขเสร็จ',
    median: 'มัธยฐาน',
    bySeverity: 'แยกตามความรุนแรง',
    byService: 'แยกตามบริการ',
    byMonth: 'แยกตามเดือน',
    month: 'เดือน',
    list: 'รายการเหตุการณ์',
    open: 'ยังไม่จบ',
    none: 'ไม่มีเหตุขัดข้องในช่วงนี้',
  },
}

export const strings = (lang: Lang): Strings => (lang === 'th' ? th : en)

export const sevLabel = (level: Level, lang: Lang) => `SEV${level} ${strings(lang).severity[level].name}`
