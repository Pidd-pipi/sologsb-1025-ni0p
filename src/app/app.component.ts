import { CommonModule } from '@angular/common';
import { Component, HostListener, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  NbAlertModule,
  NbBadgeModule,
  NbButtonModule,
  NbCardModule,
  NbCheckboxModule,
  NbIconModule,
  NbInputModule,
  NbLayoutModule,
  NbOptionModule,
  NbSelectModule,
  NbTabsetModule,
  NbToastrModule,
  NbToastrService
} from '@nebular/theme';

type WorkspaceView = 'compose' | 'checks' | 'review' | 'versions' | 'merge';
type ReviewStatus = 'pending' | 'approved' | 'changes';
type NoticeStatus = 'draft' | 'in-review' | 'locked' | 'pending-review';
type CheckLevel = 'error' | 'warning' | 'info';

/** 离线修订包可携带的字段：共享标题、影响范围，或某语言的标题/正文。 */
type RevisionField = 'title' | 'scope' | 'langTitle' | 'langBody';
type ImportOutcome = 'merged' | 'conflict' | 'duplicate' | 'stale' | 'corrupt' | 'empty';

interface RevisionChange {
  field: RevisionField;
  locale?: string;
  oldValue: string;
  newValue: string;
}

interface OfflineRevisionPackage {
  format: string;
  schemaVersion: number;
  packageId: string;
  baseVersionId: string;
  baseVersion: string;
  noticeId: string;
  author: string;
  device: string;
  createdAt: string;
  changes: RevisionChange[];
  checksum: string;
}

interface ConflictValue {
  packageId: string;
  author: string;
  device: string;
  createdAt: string;
  newValue: string;
  isBase?: boolean;
}

interface PendingConflict {
  field: RevisionField;
  locale?: string;
  values: ConflictValue[];
}

interface AppliedChange {
  field: RevisionField;
  locale?: string;
  packageId: string;
  author: string;
  device: string;
  createdAt: string;
  oldValue: string;
  newValue: string;
  appliedAt: string;
  resolution?: string;
}

interface ImportResultEntry {
  id: string;
  packageId: string;
  author: string;
  outcome: ImportOutcome;
  detail: string;
  at: string;
}

interface MergeRestoreSnapshot {
  title: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  languages: LanguageVersion[];
  reviews: RoleReview[];
  version: string;
  lockedAt?: string;
}

interface OfflineMergeState {
  baseVersionId: string;
  baseVersion: string;
  importedPackageIds: string[];
  appliedChanges: AppliedChange[];
  conflicts: PendingConflict[];
  importResults: ImportResultEntry[];
  affectedLocales: string[];
  invalidatedRoles: RoleReview['role'][];
  checksReconfirmed: boolean;
  restore: MergeRestoreSnapshot;
  mergedAt: string;
}

interface LanguageVersion {
  id: string;
  locale: string;
  name: string;
  title: string;
  body: string;
  translator: string;
  reviewed: boolean;
}

interface Discussion {
  id: string;
  languageId: string;
  sentenceIndex: number;
  author: string;
  role: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface RoleReview {
  role: '编辑' | '法务' | '翻译' | '发布人';
  owner: string;
  status: ReviewStatus;
  note: string;
}

interface VersionSnapshot {
  id: string;
  label: string;
  createdAt: string;
  version: string;
  title: string;
  severity: string;
  scope: string;
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  channels: string[];
  languages: LanguageVersion[];
  note: string;
  emergency: boolean;
}

interface NoticeDraft {
  id: string;
  title: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  eventAt: string;
  effectiveAt: string;
  expiresAt: string;
  requiredLocales: string[];
  languages: LanguageVersion[];
  discussions: Discussion[];
  reviews: RoleReview[];
  versions: VersionSnapshot[];
  status: NoticeStatus;
  version: string;
  lockedAt?: string;
  emergencyRevision: boolean;
  offlineMerge: OfflineMergeState | null;
  rejectedImports: ImportResultEntry[];
  updatedAt: string;
}

interface CheckResult {
  id: string;
  category: string;
  level: CheckLevel;
  title: string;
  detail: string;
}

interface DiffRow {
  left: string;
  right: string;
  kind: 'same' | 'changed' | 'added' | 'removed';
}

interface NoticeTemplate {
  id: string;
  name: string;
  description: string;
  eventType: string;
  severity: string;
  scope: string;
  channels: string[];
  title: Record<string, string>;
  body: Record<string, string>;
}

const STORAGE_KEY = 'sologsb-1025-emergency-notice-v1';
const PACKAGE_FORMAT = 'sologsb-emergency-notice-offline-revision';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 递归按键名排序的稳定序列化，保证校验和覆盖嵌套 changes 且不受键顺序影响。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const body = Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
      .join(',');
    return `{${body}}`;
  }
  return JSON.stringify(value);
}

/** 修订包载荷（去掉 checksum）的稳定序列化，保证校验和不受键顺序影响。 */
function packagePayload(obj: OfflineRevisionPackage): string {
  const { checksum: _checksum, ...rest } = obj;
  return stableStringify(rest);
}

/** FNV-1a 32 位校验和，用于识别传输中损坏的修订包。 */
function revisionChecksum(obj: OfflineRevisionPackage): string {
  const text = packagePayload(obj);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function initialDraft(): NoticeDraft {
  const first: VersionSnapshot = {
    id: 'version-1-0-0',
    label: '首次发布稿',
    createdAt: '2026-09-23T08:10:00+08:00',
    version: '1.0.0',
    title: '台风“海燕”橙色预警通知',
    scope: '滨海新区沿海街道',
    severity: '橙色',
    eventAt: '2026-09-23T07:30:00+08:00',
    effectiveAt: '2026-09-23T09:00:00+08:00',
    expiresAt: '2026-09-24T08:00:00+08:00',
    channels: ['短信', '广播', '社区大屏'],
    note: '发布范围覆盖滨海新区。',
    emergency: false,
    languages: [
      {
        id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警通知',
        body: '请滨海新区居民立即停止户外活动。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。',
        translator: '林晓', reviewed: true
      },
      {
        id: 'en', locale: 'en', name: 'English', title: 'Orange alert for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.',
        translator: '周晴', reviewed: true
      }
    ]
  };

  const second: VersionSnapshot = {
    ...clone(first),
    id: 'version-1-1-0',
    label: '扩大影响范围',
    createdAt: '2026-09-24T10:35:00+08:00',
    version: '1.1.0',
    title: '台风“海燕”橙色预警及人员转移通知',
    scope: '滨海新区全区，重点为沿海街道',
    note: '增加沿海街道转移要求。',
    languages: [
      {
        ...clone(first.languages[0]),
        id: 'zh-CN',
        title: '台风“海燕”橙色预警及人员转移通知',
        body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。请远离临时建筑，并关注后续通知。'
      } as LanguageVersion,
      {
        ...clone(first.languages[1]),
        id: 'en',
        title: 'Orange alert and evacuation notice for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Stay away from temporary structures and monitor further notices.'
      } as LanguageVersion
    ]
  };

  return {
    id: 'notice-haiyan-2026',
    title: '台风“海燕”橙色预警及人员转移通知',
    eventType: '台风',
    severity: '橙色',
    scope: '滨海新区全区，重点为沿海街道',
    channels: ['短信', '广播', '社区大屏', '政务新媒体'],
    eventAt: '2026-09-25T07:30',
    effectiveAt: '2026-09-25T09:00',
    expiresAt: '2026-09-26T08:00',
    requiredLocales: ['zh-CN', 'en', 'ja'],
    languages: [
      {
        id: 'zh-CN', locale: 'zh-CN', name: '简体中文', title: '台风“海燕”橙色预警及人员转移通知',
        body: '请滨海新区居民立即停止户外活动。沿海街道居民请于今日17时前转移至就近安置点。预计今天下午出现强风和暴雨。不要停留在临时建筑附近，并持续关注后续通知。',
        translator: '林晓', reviewed: true
      },
      {
        id: 'en', locale: 'en', name: 'English', title: 'Orange alert and evacuation notice for Typhoon Haiyan',
        body: 'Residents in Binhai New Area should stop outdoor activities immediately. Residents of coastal subdistricts must move to the nearest shelter before 17:00 today. Strong winds and heavy rain are expected this afternoon. Keep away from temporary buildings and continue to monitor further notices.',
        translator: '周晴', reviewed: true
      },
      {
        id: 'ja', locale: 'ja', name: '日本語', title: '台風「ハイエン」オレンジ警報',
        body: '浜海新区の住民は直ちに屋外活動を中止してください。本日午後、強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。',
        translator: '佐藤 明', reviewed: false
      }
    ],
    discussions: [
      {
        id: 'comment-1', languageId: 'zh-CN', sentenceIndex: 1, author: '陈冉', role: '法务审阅',
        text: '建议明确安置点地址由属地另行发送，避免通知被理解为完整点位清单。', createdAt: '2026-09-25T08:16:00+08:00', resolved: false
      }
    ],
    reviews: [
      { role: '编辑', owner: '林晓', status: 'approved', note: '事件要素完整。' },
      { role: '法务', owner: '陈冉', status: 'changes', note: '转移表述需补充依据。' },
      { role: '翻译', owner: '周晴', status: 'pending', note: '等待日文版复核。' },
      { role: '发布人', owner: '值班中心', status: 'pending', note: '' }
    ],
    versions: [first, second],
    status: 'in-review',
    version: '1.2.0-draft',
    emergencyRevision: false,
    offlineMerge: null,
    rejectedImports: [],
    updatedAt: new Date().toISOString()
  };
}

const TEMPLATES: NoticeTemplate[] = [
  {
    id: 'typhoon', name: '台风人员转移', description: '适用于沿海区域人员转移和停业停课提醒。',
    eventType: '台风', severity: '橙色', scope: '沿海街道', channels: ['短信', '广播', '社区大屏'],
    title: { 'zh-CN': '台风预警及人员转移通知', en: 'Typhoon alert and evacuation notice', ja: '台風警報・避難のお知らせ' },
    body: {
      'zh-CN': '请相关区域居民立即停止户外活动。危险区域人员请按属地安排转移至安全场所。预计将出现强风和暴雨，请远离临时建筑并关注后续通知。',
      en: 'Residents in the affected area should stop outdoor activities immediately. People in high-risk areas must follow local evacuation arrangements. Strong winds and heavy rain are expected. Stay away from temporary structures and monitor further notices.',
      ja: '対象地域の住民は直ちに屋外活動を中止してください。危険地域の方は自治体の避難指示に従ってください。強風と大雨が見込まれます。仮設建物に近づかず、今後の通知を確認してください。'
    }
  },
  {
    id: 'water', name: '供水异常', description: '适用于计划停水和恢复供水通知。',
    eventType: '公共设施', severity: '黄色', scope: '城市供水片区', channels: ['短信', '政务新媒体'],
    title: { 'zh-CN': '计划停水通知', en: 'Planned water service interruption', ja: '断水のお知らせ' },
    body: {
      'zh-CN': '因管网维护，相关区域将于指定时间暂停供水。请提前储水并关闭用水设备。恢复供水后可能出现短时浑浊，请排放后再使用。',
      en: 'Water service will be temporarily suspended for network maintenance. Please store water in advance and close water fixtures. Water may appear cloudy when service resumes; run the tap before use.',
      ja: '管路保守作業のため、対象地域では一時的に断水します。事前に水を確保し、水道設備を閉めてください。復旧後は濁りが生じる場合があるため、しばらく通水してから使用してください。'
    }
  },
  {
    id: 'public-safety', name: '公共安全提醒', description: '适用于大型活动周边临时管控。',
    eventType: '公共安全', severity: '黄色', scope: '活动周边道路', channels: ['广播', '社区大屏', '政务新媒体'],
    title: { 'zh-CN': '大型活动期间临时交通提醒', en: 'Temporary traffic notice during major event', ja: '大規模イベント期間中の交通規制' },
    body: {
      'zh-CN': '活动期间部分道路将采取临时管控措施。请服从现场指引，合理规划出行路线，非必要不前往管控区域。',
      en: 'Temporary traffic controls will be in place during the event. Follow on-site directions, plan your route, and avoid restricted areas unless necessary.',
      ja: 'イベント期間中、一部道路で交通規制を行います。現場の案内に従い、移動経路を事前に確認してください。不要な場合は規制区域への立入りを控えてください。'
    }
  }
];

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    NbLayoutModule,
    NbCardModule,
    NbButtonModule,
    NbInputModule,
    NbSelectModule,
    NbOptionModule,
    NbCheckboxModule,
    NbTabsetModule,
    NbIconModule,
    NbBadgeModule,
    NbAlertModule,
    NbToastrModule
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements OnInit {
  readonly templates = TEMPLATES;
  readonly eventTypes = ['台风', '暴雨', '地震', '公共卫生', '公共设施', '公共安全'];
  readonly severities = ['蓝色', '黄色', '橙色', '红色'];
  readonly channelOptions = ['短信', '广播', '社区大屏', '政务新媒体', '应急喇叭', '网站'];
  readonly locales = [
    { id: 'zh-CN', name: '简体中文' },
    { id: 'en', name: 'English' },
    { id: 'ja', name: '日本語' },
    { id: 'ko', name: '한국어' },
    { id: 'es', name: 'Español' }
  ];
  readonly bannedTerms = ['大概', '可能吧', '无需恐慌', '绝对不会', '保证安全'];
  readonly glossary = [
    { canonical: '立即', variants: ['马上', '赶紧'] },
    { canonical: '安置点', variants: ['避难所', '庇护所'] },
    { canonical: '持续关注', variants: ['随时留意', '保持观看'] }
  ];
  readonly roles: RoleReview['role'][] = ['编辑', '法务', '翻译', '发布人'];

  draft: NoticeDraft = initialDraft();
  activeView: WorkspaceView = 'compose';
  selectedLanguageId = 'zh-CN';
  selectedSentenceIndex = 0;
  selectedTemplateId = 'typhoon';
  discussionText = '';
  currentRole: RoleReview['role'] = '编辑';
  compareBaseId = '';
  compareTargetId = '';
  lastSavedAt = '';
  history: NoticeDraft[] = [];
  future: NoticeDraft[] = [];

  // 离线修订包制作与导入
  builderBaseVersionId = '';
  builderAuthor = '外勤一组';
  builderDevice = '移动终端 A12';
  builderTitleChanged = false;
  builderScopeChanged = false;
  builderTitle = '';
  builderScope = '';
  builderLangEdits: Record<string, { titleChanged: boolean; bodyChanged: boolean; title: string; body: string }> = {};
  generatedPackageText = '';
  importText = '';
  mergeLogExpanded = false;

  constructor(private readonly toastr: NbToastrService) {}

  ngOnInit(): void {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.draft = this.migrate(JSON.parse(saved) as NoticeDraft);
      } catch {
        localStorage.removeItem(STORAGE_KEY);
        this.draft = initialDraft();
      }
    }
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.lastSavedAt = this.formatDateTime(this.draft.updatedAt);
    this.initBuilder();
  }

  @HostListener('window:keydown', ['$event'])
  handleKeyboard(event: KeyboardEvent): void {
    const modifier = event.metaKey || event.ctrlKey;
    if (!modifier) return;
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault();
      event.shiftKey ? this.redo() : this.undo();
    } else if (event.key.toLowerCase() === 'y') {
      event.preventDefault();
      this.redo();
    } else if (event.key.toLowerCase() === 's') {
      event.preventDefault();
      this.saveNow();
      this.toastr.success('草稿已保存在当前浏览器。', '保存成功');
    }
  }

  get selectedLanguage(): LanguageVersion {
    return this.draft.languages.find((language) => language.id === this.selectedLanguageId) ?? this.draft.languages[0];
  }

  get selectedTemplateDescription(): string {
    return this.templates.find((template) => template.id === this.selectedTemplateId)?.description ?? '请选择一个模板';
  }

  get unresolvedDiscussionCount(): number {
    return this.draft.discussions.filter((discussion) => !discussion.resolved).length;
  }

  get currentSentences(): string[] {
    return this.splitSentences(this.selectedLanguage?.body ?? '');
  }

  get activeDiscussions(): Discussion[] {
    return this.draft.discussions.filter((discussion) => discussion.languageId === this.selectedLanguageId);
  }

  get checks(): CheckResult[] {
    const checks: CheckResult[] = [];
    const requiredMeta: Array<[string, string]> = [
      ['标题', this.draft.title], ['事件类型', this.draft.eventType], ['严重程度', this.draft.severity],
      ['影响范围', this.draft.scope], ['事件时间', this.draft.eventAt], ['生效时间', this.draft.effectiveAt],
      ['失效时间', this.draft.expiresAt]
    ];
    requiredMeta.filter(([, value]) => !value).forEach(([label]) => checks.push({
      id: `meta-${label}`, category: '必填信息', level: 'error', title: `缺少${label}`,
      detail: `请补全通知的${label}后再提交发布。`
    }));
    if (!this.draft.channels.length) checks.push({
      id: 'channels', category: '发布渠道', level: 'error', title: '未选择目标渠道', detail: '至少选择一个目标发布渠道。'
    });

    this.draft.requiredLocales.forEach((locale) => {
      if (!this.draft.languages.some((language) => language.id === locale)) {
        const name = this.locales.find((item) => item.id === locale)?.name ?? locale;
        checks.push({
          id: `missing-${locale}`, category: '语言完整性', level: 'error', title: `${name}版本缺失`,
          detail: '该语言属于本次发布的必需语言，请添加并完成翻译。'
        });
      }
    });

    this.draft.languages.forEach((language) => {
      if (!language.title.trim() || !language.body.trim()) checks.push({
        id: `required-${language.id}`, category: '必填信息', level: 'error', title: `${language.name}内容不完整`,
        detail: '语言版本必须包含标题和正文。'
      });
      if (!language.reviewed) checks.push({
        id: `review-${language.id}`, category: '版本审阅', level: language.id === 'ja' ? 'warning' : 'info',
        title: `${language.name}尚未完成语言复核`, detail: '发布前应确认措辞、术语和本地化表达。'
      });
      const banned = this.bannedTerms.filter((term) => language.body.includes(term));
      if (banned.length) checks.push({
        id: `banned-${language.id}`, category: '禁用词', level: 'error', title: `${language.name}包含禁用词`,
        detail: `请替换：${banned.join('、')}。`
      });
      const inconsistent = this.glossary.filter((entry) => {
        const variantCount = entry.variants.filter((variant) => language.body.includes(variant)).length;
        return variantCount > 0 && (!language.body.includes(entry.canonical) || variantCount > 1);
      });
      if (inconsistent.length) checks.push({
        id: `term-${language.id}`, category: '术语一致性', level: 'warning', title: `${language.name}术语不统一`,
        detail: inconsistent.map((item) => `统一使用“${item.canonical}”，避免“${item.variants.join('、')}”`).join('；')
      });
    });

    const eventAt = this.toTime(this.draft.eventAt);
    const effectiveAt = this.toTime(this.draft.effectiveAt);
    const expiresAt = this.toTime(this.draft.expiresAt);
    if (eventAt && effectiveAt && effectiveAt < eventAt) checks.push({
      id: 'time-effective', category: '时间冲突', level: 'warning', title: '生效时间早于事件时间',
      detail: '请确认这是预防性通知；否则调整事件时间或生效时间。'
    });
    if (effectiveAt && expiresAt && expiresAt <= effectiveAt) checks.push({
      id: 'time-expires', category: '时间冲突', level: 'error', title: '失效时间早于生效时间',
      detail: '通知有效期必须晚于生效时间。'
    });
    const unresolved = this.draft.discussions.filter((discussion) => !discussion.resolved).length;
    if (unresolved) checks.push({
      id: 'discussions', category: '逐句讨论', level: 'warning', title: `${unresolved} 条讨论尚未解决`,
      detail: '发布前请处理或明确忽略未解决讨论。'
    });
    return checks;
  }

  get blockingChecks(): CheckResult[] {
    return this.checks.filter((check) => check.level === 'error');
  }

  get warningCount(): number {
    return this.checks.filter((check) => check.level === 'warning').length;
  }

  get isLocked(): boolean {
    return this.draft.status === 'locked';
  }

  get isPendingReview(): boolean {
    return this.draft.status === 'pending-review';
  }

  get mergeState(): OfflineMergeState | null {
    return this.draft.offlineMerge;
  }

  get pendingConflictCount(): number {
    return this.draft.offlineMerge?.conflicts.length ?? 0;
  }

  get hasMergeConflicts(): boolean {
    return this.pendingConflictCount > 0;
  }

  get mergeReadyToLock(): boolean {
    const state = this.draft.offlineMerge;
    if (!state) return true;
    return state.conflicts.length === 0 && state.checksReconfirmed;
  }

  get allReviewsApproved(): boolean {
    return this.draft.reviews.every((review) => review.status === 'approved');
  }

  get hasIncompleteReviews(): boolean {
    return this.draft.reviews.some((review) => review.status !== 'approved');
  }

  isSentenceDiscussed(index: number): boolean {
    return this.activeDiscussions.some((discussion) => discussion.sentenceIndex === index && !discussion.resolved);
  }

  get nextVersion(): string {
    const numbers = this.draft.version.match(/\d+/g)?.map(Number) ?? [1, 2, 0];
    return `${numbers[0] || 1}.${(numbers[1] || 0) + 1}.0`;
  }

  get versionDiff(): DiffRow[] {
    const base = this.draft.versions.find((version) => version.id === this.compareBaseId);
    const target = this.draft.versions.find((version) => version.id === this.compareTargetId);
    if (!base || !target) return [];
    const baseLanguage = base.languages.find((language) => language.id === this.selectedLanguageId);
    const targetLanguage = target.languages.find((language) => language.id === this.selectedLanguageId);
    return this.diffSentences(this.splitSentences(baseLanguage?.body ?? ''), this.splitSentences(targetLanguage?.body ?? ''));
  }

  updateMeta(field: 'title' | 'eventType' | 'severity' | 'scope' | 'eventAt' | 'effectiveAt' | 'expiresAt', value: string): void {
    this.commit((draft) => {
      (draft as unknown as Record<string, unknown>)[field] = value;
      draft.status = draft.status === 'locked' ? 'draft' : draft.status;
      this.invalidateMergeChecks(draft, field === 'title' ? ['zh-CN', 'en', 'ja', 'ko', 'es'] : []);
    });
  }

  toggleChannel(channel: string, checked: boolean): void {
    this.commit((draft) => {
      draft.channels = checked ? [...new Set([...draft.channels, channel])] : draft.channels.filter((item) => item !== channel);
      this.invalidateMergeChecks(draft, ['zh-CN', 'en', 'ja', 'ko', 'es']);
    });
  }

  toggleRequiredLocale(locale: string, checked: boolean): void {
    this.commit((draft) => {
      draft.requiredLocales = checked
        ? [...new Set([...draft.requiredLocales, locale])]
        : draft.requiredLocales.filter((item) => item !== locale);
      this.invalidateMergeChecks(draft, [locale]);
    });
  }

  updateLanguage(field: 'title' | 'body' | 'translator', value: string): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language[field] = value;
      if (field !== 'translator') this.invalidateMergeChecks(draft, [this.selectedLanguageId]);
    });
  }

  setLanguageReviewed(checked: boolean): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language.reviewed = checked;
    });
  }

  /** 待复核稿上的内容改动会让发布前检查复核结论失效，需值班员重新确认。 */
  private invalidateMergeChecks(draft: NoticeDraft, locales: string[]): void {
    const merge = draft.offlineMerge;
    if (!merge) return;
    merge.checksReconfirmed = false;
    if (locales.length) {
      merge.affectedLocales = [...new Set([...merge.affectedLocales, ...locales])];
      draft.languages.forEach((language) => {
        if (locales.includes(language.id)) language.reviewed = false;
      });
    }
  }

  selectSentence(index: number): void {
    this.selectedSentenceIndex = index;
  }

  addDiscussion(): void {
    const text = this.discussionText.trim();
    if (!text || this.isLocked) return;
    this.commit((draft) => {
      draft.discussions.push({
        id: uid('discussion'), languageId: this.selectedLanguageId, sentenceIndex: this.selectedSentenceIndex,
        author: this.currentRole === '法务' ? '陈冉' : this.currentRole === '翻译' ? '周晴' : '林晓',
        role: `${this.currentRole}审阅`, text, createdAt: new Date().toISOString(), resolved: false
      });
    });
    this.discussionText = '';
    this.toastr.success('讨论已绑定到当前句。', '已添加');
  }

  toggleDiscussion(discussionId: string): void {
    this.commit((draft) => {
      const item = draft.discussions.find((discussion) => discussion.id === discussionId);
      if (item) item.resolved = !item.resolved;
    });
  }

  setReviewStatus(role: RoleReview['role'], status: ReviewStatus): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) review.status = status;
    });
  }

  setReviewNote(role: RoleReview['role'], note: string): void {
    this.commit((draft) => {
      const review = draft.reviews.find((item) => item.role === role);
      if (review) review.note = note;
    });
  }

  applyTemplate(): void {
    const template = this.templates.find((item) => item.id === this.selectedTemplateId);
    if (!template || this.isLocked) return;
    this.commit((draft) => {
      draft.eventType = template.eventType;
      draft.severity = template.severity;
      draft.scope = template.scope;
      draft.channels = [...template.channels];
      draft.languages.forEach((language) => {
        language.title = template.title[language.id] ?? language.title;
        language.body = template.body[language.id] ?? language.body;
        language.reviewed = false;
      });
      this.invalidateMergeChecks(draft, draft.languages.map((language) => language.id));
    });
    this.toastr.success(`已应用“${template.name}”模板，请根据事件信息调整。`, '模板复用');
  }

  lockVersion(): void {
    if (this.draft.offlineMerge?.conflicts.length) {
      this.toastr.warning(`仍有 ${this.draft.offlineMerge.conflicts.length} 个待决冲突，不能生成正式新稿。`, '离线合并未完成');
      this.activeView = 'merge';
      return;
    }
    if (this.draft.offlineMerge && !this.draft.offlineMerge.checksReconfirmed) {
      this.toastr.warning('离线合入后发布前检查已失效，请值班员重新确认检查结果。', '检查待复核');
      this.activeView = 'checks';
      return;
    }
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能锁定。`, '发布检查未通过');
      this.activeView = 'checks';
      return;
    }
    if (!this.allReviewsApproved) {
      this.toastr.warning('受影响责任角色尚未重新确认，不能锁定。', '责任链未完成');
      this.activeView = 'review';
      return;
    }
    const merge = this.draft.offlineMerge;
    const snapshot: VersionSnapshot = {
      id: uid('version'),
      label: merge ? '离线修订合并锁定版本' : '最终锁定版本',
      createdAt: new Date().toISOString(), version: this.nextVersion,
      title: this.draft.title, severity: this.draft.severity, scope: this.draft.scope, eventAt: this.draft.eventAt,
      effectiveAt: this.draft.effectiveAt, expiresAt: this.draft.expiresAt, channels: [...this.draft.channels],
      languages: clone(this.draft.languages),
      note: merge
        ? `离线合并 ${merge.importedPackageIds.length} 个修订包（${merge.appliedChanges.length} 处改动已合入），冲突均已裁决并重新确认。`
        : '发布前检查通过并锁定。',
      emergency: false
    };
    this.commit((draft) => {
      draft.versions.push(snapshot);
      draft.version = snapshot.version;
      draft.status = 'locked';
      draft.lockedAt = snapshot.createdAt;
      draft.emergencyRevision = false;
      draft.offlineMerge = null;
      draft.rejectedImports = [];
    });
    this.compareBaseId = this.draft.versions.at(-2)?.id ?? '';
    this.compareTargetId = this.draft.versions.at(-1)?.id ?? '';
    this.toastr.success(`版本 ${snapshot.version} 已锁定。`, '最终版本已冻结');
  }

  startEmergencyRevision(): void {
    const baseVersion = this.draft.version.split('-')[0];
    const [major = 1, minor = 0] = baseVersion.split('.').map(Number);
    this.commit((draft) => {
      draft.status = 'draft';
      draft.emergencyRevision = true;
      draft.version = `${major}.${minor + 1}.0-emergency`;
      draft.lockedAt = undefined;
    });
    this.activeView = 'compose';
    this.toastr.warning('已创建紧急修订稿；锁定版本仍完整保留。', '进入紧急修订');
  }

  showCheck(check: CheckResult): void {
    if (check.id.startsWith('missing-') || check.id.startsWith('required-') || check.id.startsWith('banned-') || check.id.startsWith('term-')) {
      const locale = check.id.split('-').at(-1);
      if (locale && this.draft.languages.some((language) => language.id === locale)) this.selectedLanguageId = locale;
      this.activeView = 'compose';
    } else if (check.id === 'discussions') {
      this.activeView = 'review';
    }
  }

  undo(): void {
    const previous = this.history.pop();
    if (!previous) {
      this.toastr.info('没有可撤销的操作。', '撤销');
      return;
    }
    this.future.push(clone(this.draft));
    this.draft = previous;
    this.persist();
  }

  redo(): void {
    const next = this.future.pop();
    if (!next) {
      this.toastr.info('没有可重做的操作。', '重做');
      return;
    }
    this.history.push(clone(this.draft));
    this.draft = next;
    this.persist();
  }

  saveNow(): void {
    this.persist();
  }

  // ───────────────────────── 离线修订包：制作 ─────────────────────────

  get latestLockedVersion(): VersionSnapshot | undefined {
    return this.draft.versions.at(-1);
  }

  get canBuildPackage(): boolean {
    return !!this.latestLockedVersion;
  }

  get builderBase(): VersionSnapshot | undefined {
    return this.draft.versions.find((version) => version.id === this.builderBaseVersionId) ?? this.latestLockedVersion;
  }

  get builderLanguageIds(): string[] {
    return this.builderBase?.languages.map((language) => language.id) ?? [];
  }

  initBuilder(): void {
    const base = this.latestLockedVersion;
    if (!base) return;
    this.builderBaseVersionId = base.id;
    this.loadBuilderFromBase();
  }

  loadBuilderFromBase(): void {
    const base = this.builderBase;
    if (!base) return;
    this.builderTitle = base.title;
    this.builderScope = base.scope;
    this.builderTitleChanged = false;
    this.builderScopeChanged = false;
    this.builderLangEdits = {};
    base.languages.forEach((language) => {
      this.builderLangEdits[language.id] = {
        titleChanged: false, bodyChanged: false, title: language.title, body: language.body
      };
    });
    this.generatedPackageText = '';
  }

  get builderChangeCount(): number {
    let count = Number(this.builderTitleChanged) + Number(this.builderScopeChanged);
    Object.values(this.builderLangEdits).forEach((edit) => {
      count += Number(edit.titleChanged) + Number(edit.bodyChanged);
    });
    return count;
  }

  get hasGeneratedPackage(): boolean {
    return !!this.generatedPackageText;
  }

  buildRevisionPackage(): void {
    const base = this.builderBase;
    if (!base) {
      this.toastr.warning('没有可作为基础版本的锁定稿。', '无法制作修订包');
      return;
    }
    const changes: RevisionChange[] = [];
    if (this.builderTitleChanged) {
      changes.push({ field: 'title', oldValue: base.title, newValue: this.builderTitle.trim() });
    }
    if (this.builderScopeChanged) {
      changes.push({ field: 'scope', oldValue: base.scope, newValue: this.builderScope.trim() });
    }
    base.languages.forEach((language) => {
      const edit = this.builderLangEdits[language.id];
      if (!edit) return;
      if (edit.titleChanged) changes.push({ field: 'langTitle', locale: language.id, oldValue: language.title, newValue: edit.title.trim() });
      if (edit.bodyChanged) changes.push({ field: 'langBody', locale: language.id, oldValue: language.body, newValue: edit.body.trim() });
    });
    if (!changes.length) {
      this.toastr.info('没有任何字段被修改，修订包只携带实际改过的字段。', '包为空');
      this.generatedPackageText = '';
      return;
    }
    const draft: OfflineRevisionPackage = {
      format: PACKAGE_FORMAT,
      schemaVersion: 1,
      packageId: uid('rev'),
      baseVersionId: base.id,
      baseVersion: base.version,
      noticeId: this.draft.id,
      author: this.builderAuthor.trim() || '未署名外勤',
      device: this.builderDevice.trim() || '离线终端',
      createdAt: new Date().toISOString(),
      changes,
      checksum: ''
    };
    draft.checksum = revisionChecksum(draft);
    this.generatedPackageText = JSON.stringify(draft, null, 2);
    this.toastr.success(`修订包已生成，包含 ${changes.length} 处实际改动。`, '离线修订包');
  }

  sendGeneratedPackageToImport(): void {
    if (!this.generatedPackageText) return;
    this.importText = this.generatedPackageText;
    this.toastr.info('已放入导入区，点击“导入并合并”即可处理。', '已送入导入区');
  }

  copyGeneratedPackage(): void {
    if (!this.generatedPackageText) return;
    const text = this.generatedPackageText;
    const done = () => this.toastr.success('修订包 JSON 已复制，可交给值班员。', '已复制');
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).then(done).catch(() => this.fallbackCopy(text, done));
    } else {
      this.fallbackCopy(text, done);
    }
  }

  private fallbackCopy(text: string, done: () => void): void {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
    done();
  }

  /** 示例：两个外勤互不干扰，分别改标题、影响范围和不同语言正文（全部可合）。 */
  fillComplementarySamples(): void {
    const base = this.latestLockedVersion;
    if (!base) {
      this.toastr.warning('当前还没有锁定稿，请先在“锁定与比较”中锁定。', '缺少基础版本');
      return;
    }
    const zh = base.languages.find((language) => language.id === 'zh-CN');
    const en = base.languages.find((language) => language.id === 'en');
    const first = this.makeSamplePackage(base, '外勤一组', '移动终端 A12', [
      { field: 'title', oldValue: base.title, newValue: `${base.title}（第二次更新）` },
      ...(zh ? [{ field: 'langBody' as RevisionField, locale: 'zh-CN', oldValue: zh.body, newValue: `${zh.body}请保持通讯畅通，服从现场人员引导。` }] : [])
    ]);
    const second = this.makeSamplePackage(base, '外勤二组', '移动终端 B07', [
      { field: 'scope', oldValue: base.scope, newValue: `${base.scope}及附近避险区域` },
      ...(en ? [{ field: 'langBody' as RevisionField, locale: 'en', oldValue: en.body, newValue: `${en.body} Keep communication lines open and follow on-site staff.` }] : [])
    ]);
    this.importText = JSON.stringify([first, second], null, 2);
    this.toastr.info('已填入两个互补修订包（标题+中文正文 / 影响范围+英文正文）。', '示例已填入');
  }

  /** 示例：两个外勤都改了同一字段的不同新值，导入后形成待决冲突。 */
  fillConflictSample(): void {
    const base = this.latestLockedVersion;
    if (!base) {
      this.toastr.warning('当前还没有锁定稿，请先在“锁定与比较”中锁定。', '缺少基础版本');
      return;
    }
    const zh = base.languages.find((language) => language.id === 'zh-CN');
    if (!zh) return;
    const first = this.makeSamplePackage(base, '外勤一组', '移动终端 A12', [
      { field: 'langBody', locale: 'zh-CN', oldValue: zh.body, newValue: '请立即停止户外活动，并按社区指引有序转移。' }
    ]);
    const second = this.makeSamplePackage(base, '外勤三组', '移动终端 C21', [
      { field: 'langBody', locale: 'zh-CN', oldValue: zh.body, newValue: '请勿外出，已在室内的人员远离窗户并做好防护。' }
    ]);
    this.importText = JSON.stringify([first, second], null, 2);
    this.toastr.info('已填入两个对中文正文给出不同新值的修订包。', '冲突示例已填入');
  }

  /** 示例：基础版本指向更早快照，按过期处理。 */
  fillStaleSample(): void {
    const target = this.draft.versions.at(-2) ?? this.latestLockedVersion;
    if (!target) {
      this.toastr.warning('暂无可用于演示的历史版本。', '缺少基础版本');
      return;
    }
    const zh = target.languages.find((language) => language.id === 'zh-CN');
    const stale = this.makeSamplePackage(target, '外勤一组', '移动终端 A12', [
      { field: 'scope', oldValue: target.scope, newValue: `${target.scope}（旧稿上的改动）` },
      ...(zh ? [{ field: 'langTitle' as RevisionField, locale: 'zh-CN', oldValue: zh.title, newValue: `${zh.title}（旧稿）` }] : [])
    ]);
    this.importText = JSON.stringify(stale, null, 2);
    this.toastr.info('该包基于旧锁定稿，导入时会给出“基础版本已过期”的明确结果。', '过期示例已填入');
  }

  /** 示例：传输内容被破坏 / 校验和对不上，按损坏处理。 */
  fillCorruptSample(): void {
    const base = this.latestLockedVersion;
    if (!base) {
      this.toastr.warning('当前还没有锁定稿，请先在“锁定与比较”中锁定。', '缺少基础版本');
      return;
    }
    const corrupt = this.makeSamplePackage(base, '外勤二组', '移动终端 B07', [
      { field: 'scope', oldValue: base.scope, newValue: `${base.scope}及临时安置片区` }
    ]);
    corrupt.changes[0].newValue = `${corrupt.changes[0].newValue}（传输中被改写）`;
    // checksum 故意不重算
    this.importText = JSON.stringify(corrupt, null, 2);
    this.toastr.info('内容已被改写但校验和未更新，导入时会判定为损坏包。', '损坏示例已填入');
  }

  private makeSamplePackage(
    base: VersionSnapshot,
    author: string,
    device: string,
    changes: RevisionChange[]
  ): OfflineRevisionPackage {
    const draft: OfflineRevisionPackage = {
      format: PACKAGE_FORMAT,
      schemaVersion: 1,
      packageId: uid('rev'),
      baseVersionId: base.id,
      baseVersion: base.version,
      noticeId: this.draft.id,
      author, device,
      createdAt: new Date().toISOString(),
      changes,
      checksum: ''
    };
    draft.checksum = revisionChecksum(draft);
    return draft;
  }

  // ───────────────────────── 离线修订包：导入与合并 ─────────────────────────

  get importEligible(): boolean {
    return this.draft.status === 'locked' || this.draft.status === 'pending-review';
  }

  get recentImportResults(): ImportResultEntry[] {
    return [
      ...(this.draft.offlineMerge?.importResults ?? []),
      ...(this.draft.status === 'locked' ? this.draft.rejectedImports : [])
    ].slice(-this.mergeLogCap);
  }

  get importSummary(): string {
    return this.recentImportResults.length > this.mergeLogCap
      ? `最近 ${this.mergeLogCap} 条 / 共 ${this.recentImportResults.length} 条`
      : `共 ${this.recentImportResults.length} 条`;
  }

  private readonly mergeLogCap = 40;

  importRevisionPackages(): void {
    const raw = this.importText.trim();
    if (!raw) {
      this.toastr.warning('请粘贴一个修订包或修订包数组的 JSON。', '导入区为空');
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.toastr.danger('无法解析 JSON，修订包可能在传输中损坏，未导入任何内容。', '包损坏');
      return;
    }
    const rawPackages: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
    if (!rawPackages.length) {
      this.toastr.warning('数组中没有任何修订包。', '包为空');
      return;
    }

    if (!this.importEligible) {
      this.toastr.warning('只有锁定稿或待复核稿能接收离线修订包，请先锁定当前版本。', '当前不是锁定稿');
      return;
    }

    const base = this.latestLockedVersion!;

    type Validated =
      | { kind: 'ok'; pkg: OfflineRevisionPackage }
      | { kind: 'corrupt'; packageId: string; author: string; detail: string }
      | { kind: 'duplicate'; packageId: string; author: string }
      | { kind: 'stale'; packageId: string; author: string; detail: string };

    const seenInBatch = new Set<string>();
    const validated: Validated[] = rawPackages.map((candidate) => {
      const failure = this.validatePackageShape(candidate);
      const pkg = candidate as Partial<OfflineRevisionPackage>;
      const packageId = typeof pkg.packageId === 'string' ? pkg.packageId : '(无编号)';
      const author = typeof pkg.author === 'string' ? pkg.author : '未知作者';
      if (failure) return { kind: 'corrupt', packageId, author, detail: failure };
      const full = candidate as OfflineRevisionPackage;
      if (revisionChecksum(full) !== full.checksum) {
        return { kind: 'corrupt', packageId, author, detail: '校验和与内容不一致，包在传输中被破坏。' };
      }
      if (seenInBatch.has(full.packageId)) {
        return { kind: 'duplicate', packageId: full.packageId, author: full.author };
      }
      seenInBatch.add(full.packageId);
      if (this.draft.offlineMerge?.importedPackageIds.includes(full.packageId)) {
        return { kind: 'duplicate', packageId: full.packageId, author: full.author };
      }
      if (full.baseVersionId !== base.id) {
        const detail = this.draft.versions.some((version) => version.id === full.baseVersionId)
          ? `包基于锁定稿 ${full.baseVersion}，当前最新锁定稿为 ${base.version}，请让外勤基于新稿重新导出。`
          : `包声称基于 ${full.baseVersion}，但该锁定稿在当前工作台中不存在。`;
        return { kind: 'stale', packageId: full.packageId, author: full.author, detail };
      }
      return { kind: 'ok', pkg: full };
    });

    const ok = validated
      .filter((item): item is { kind: 'ok'; pkg: OfflineRevisionPackage } => item.kind === 'ok')
      .map((item) => item.pkg);
    if (!ok.length) {
      // 没有任何可合入内容，但损坏/过期/重复结果仍要留痕，供值班员核对。
      this.recordRejectedOnly(validated);
      return;
    }

    this.commit((draft) => {
      const merge = draft.offlineMerge ?? this.createMergeState(draft);
      draft.offlineMerge = merge;
      if (!draft.offlineMerge.importedPackageIds.length && draft.rejectedImports.length) {
        merge.importResults.push(...draft.rejectedImports);
        draft.rejectedImports = [];
      }
      const aggregate = { locales: new Set<string>(), roles: new Set<RoleReview['role']>() };
      ok.forEach((pkg) => {
        const outcome = pkg.changes.length
          ? this.applyPackageToDraft(draft, merge, pkg, base, aggregate)
          : 'empty';
        if (outcome !== 'empty') merge.importedPackageIds.push(pkg.packageId);
        merge.importResults.push({
          id: uid('import'), packageId: pkg.packageId, author: pkg.author, outcome,
          detail: outcome === 'merged'
            ? `${pkg.author} 的 ${pkg.changes.length} 处改动全部无冲突，已进入待复核稿。`
            : outcome === 'conflict'
              ? `${pkg.author} 的部分字段与此前合入内容冲突，已列入待决冲突。`
              : `${pkg.author} 的包不含任何改动字段，未修改待复核稿。`,
          at: new Date().toISOString()
        });
      });
      validated.forEach((item) => {
        if (item.kind === 'corrupt' || item.kind === 'stale') {
          merge.importResults.push({
            id: uid('import'), packageId: item.packageId, author: item.author,
            outcome: item.kind, detail: item.detail, at: new Date().toISOString()
          });
        } else if (item.kind === 'duplicate') {
          merge.importResults.push({
            id: uid('import'), packageId: item.packageId, author: item.author,
            outcome: 'duplicate', detail: '该修订包此前已导入，重复导入已被忽略。', at: new Date().toISOString()
          });
        }
      });
      if (merge.importResults.length > this.mergeLogCap) {
        merge.importResults = merge.importResults.slice(-this.mergeLogCap);
      }
      this.finalizeMerge(draft, merge, aggregate.locales, aggregate.roles);
    });

    const counts = this.summarizeOutcomes(validated, ok);
    this.toastr.success(
      `无冲突 ${counts.merged} 包 · 待决冲突 ${counts.conflict} 包；过期 ${counts.stale}、损坏 ${counts.corrupt}、重复 ${counts.duplicate} 包已分别标注。`,
      '离线合并完成'
    );
    if (this.pendingConflictCount) this.toastr.warning('存在待决冲突，处理完成前不能生成正式新稿。', '需要裁决');
  }

  private validatePackageShape(candidate: unknown): string | null {
    if (typeof candidate !== 'object' || candidate === null) return '修订包不是有效的对象。';
    const pkg = candidate as Record<string, unknown>;
    if (pkg.format !== PACKAGE_FORMAT) return `格式标识不正确（期望 ${PACKAGE_FORMAT}）。`;
    if (typeof pkg.packageId !== 'string' || !pkg.packageId) return '缺少包编号 packageId。';
    if (typeof pkg.baseVersionId !== 'string' || !pkg.baseVersionId) return '缺少来源锁定稿编号 baseVersionId。';
    if (typeof pkg.baseVersion !== 'string' || !pkg.baseVersion) return '缺少来源锁定稿版本 baseVersion。';
    if (typeof pkg.checksum !== 'string' || !pkg.checksum.startsWith('fnv1a-')) return '缺少校验和或校验和格式错误。';
    if (!Array.isArray(pkg.changes)) return 'changes 字段缺失或不是数组。';
    const changes = pkg.changes as unknown[];
    for (const rawChange of changes) {
      if (typeof rawChange !== 'object' || rawChange === null) return '存在不是对象的改动条目。';
      const change = rawChange as Record<string, unknown>;
      if (change.field !== 'title' && change.field !== 'scope' && change.field !== 'langTitle' && change.field !== 'langBody') {
        return `存在不支持的字段：${String(change.field)}。`;
      }
      if (typeof change.oldValue !== 'string' || typeof change.newValue !== 'string') return '改动条目缺少 oldValue/newValue。';
      if (change.field === 'langTitle' || change.field === 'langBody') {
        if (typeof change.locale !== 'string' || !change.locale) return '语言级改动缺少 locale。';
      }
    }
    return null;
  }

  private recordRejectedOnly(validated: Array<
    { kind: 'ok' } | { kind: 'corrupt' | 'stale' | 'duplicate'; packageId: string; author: string; detail?: string }
  >): void {
    let corrupt = 0;
    let stale = 0;
    let duplicate = 0;
    const entries: ImportResultEntry[] = [];
    validated.forEach((item) => {
      const at = new Date().toISOString();
      if (item.kind === 'corrupt') {
        corrupt += 1;
        entries.push({ id: uid('import'), packageId: item.packageId, author: item.author, outcome: 'corrupt', detail: item.detail ?? '修订包结构或校验和异常。', at });
      } else if (item.kind === 'stale') {
        stale += 1;
        entries.push({ id: uid('import'), packageId: item.packageId, author: item.author, outcome: 'stale', detail: item.detail ?? '基础版本已过期。', at });
      } else if (item.kind === 'duplicate') {
        duplicate += 1;
        entries.push({ id: uid('import'), packageId: item.packageId, author: item.author, outcome: 'duplicate', detail: '该修订包此前已导入，重复导入已被忽略。', at });
      }
    });
    // 全部被拒绝时不进入待复核稿；锁定稿上不创建在途合并，仅把明确结果留痕。
    this.commit((draft) => {
      const target = draft.offlineMerge?.importResults ?? draft.rejectedImports;
      entries.forEach((entry) => target.push(entry));
      if (target.length > this.mergeLogCap) target.splice(0, target.length - this.mergeLogCap);
    });
    const message = `过期 ${stale} 包、损坏 ${corrupt} 包、重复 ${duplicate} 包，未修改待复核稿。`;
    if (corrupt) this.toastr.danger(message, '没有可合入的修订包');
    else this.toastr.warning(message, '没有可合入的修订包');
  }

  private createMergeState(draft: NoticeDraft): OfflineMergeState {
    const base = this.latestLockedVersion!;
    return {
      baseVersionId: base.id,
      baseVersion: base.version,
      importedPackageIds: [],
      appliedChanges: [],
      conflicts: [],
      importResults: [],
      affectedLocales: [],
      invalidatedRoles: [],
      checksReconfirmed: false,
      restore: {
        title: draft.title,
        eventType: draft.eventType,
        severity: draft.severity,
        scope: draft.scope,
        channels: [...draft.channels],
        eventAt: draft.eventAt,
        effectiveAt: draft.effectiveAt,
        expiresAt: draft.expiresAt,
        languages: clone(draft.languages),
        reviews: clone(draft.reviews),
        version: draft.version,
        lockedAt: draft.lockedAt
      },
      mergedAt: new Date().toISOString()
    };
  }

  /** 对单个包执行三方合并，返回该包整体结果（全部合入 / 出现冲突 / 无改动）。 */
  private applyPackageToDraft(
    draft: NoticeDraft,
    merge: OfflineMergeState,
    pkg: OfflineRevisionPackage,
    base: VersionSnapshot,
    aggregate: { locales: Set<string>; roles: Set<RoleReview['role']> }
  ): 'merged' | 'conflict' {
    let hadConflict = false;
    pkg.changes.forEach((change) => {
      const identity = this.changeIdentity(change);
      const baseValue = this.readVersionValue(base, change.field, change.locale);
      const currentValue = this.readDraftValue(draft, change.field, change.locale);
      const existingApplied = merge.appliedChanges.find((item) => this.changeIdentity(item) === identity);
      const existingConflict = merge.conflicts.find((item) => this.changeIdentity(item) === identity);

      // 同值改动：多个外勤给出相同新值不构成冲突。
      if (existingApplied && existingApplied.newValue === change.newValue) {
        this.collectImpact(change, aggregate);
        return;
      }
      // 同一字段出现第二种新值 → 待决冲突；当前稿保持先到的值，不动。
      if (existingApplied || existingConflict) {
        hadConflict = true;
        if (existingConflict) {
          if (!existingConflict.values.some((value) => value.newValue === change.newValue)) {
            existingConflict.values.push({
              packageId: pkg.packageId, author: pkg.author, device: pkg.device,
              createdAt: pkg.createdAt, newValue: change.newValue
            });
          }
        } else {
          merge.appliedChanges = merge.appliedChanges.filter((item) => this.changeIdentity(item) !== identity);
          merge.conflicts.push({
            field: change.field, locale: change.locale,
            values: [
              {
                packageId: existingApplied!.packageId, author: existingApplied!.author, device: existingApplied!.device,
                createdAt: existingApplied!.createdAt, newValue: existingApplied!.newValue
              },
              { packageId: pkg.packageId, author: pkg.author, device: pkg.device, createdAt: pkg.createdAt, newValue: change.newValue }
            ]
          });
        }
        return;
      }
      // 首个新值：若待复核稿已被值班员手工改成别的值，连同现值一起列冲突。
      if (currentValue !== change.newValue && currentValue !== baseValue) {
        hadConflict = true;
        merge.conflicts.push({
          field: change.field, locale: change.locale,
          values: [
            {
              packageId: `base:${base.id}`, author: '待复核稿现值', device: '值班工作台',
              createdAt: base.createdAt, newValue: currentValue, isBase: true
            },
            { packageId: pkg.packageId, author: pkg.author, device: pkg.device, createdAt: pkg.createdAt, newValue: change.newValue }
          ]
        });
        return;
      }
      if (currentValue === change.newValue) return;
      this.writeDraftValue(draft, change.field, change.locale, change.newValue);
      merge.appliedChanges.push({
        field: change.field, locale: change.locale, packageId: pkg.packageId, author: pkg.author,
        device: pkg.device, createdAt: pkg.createdAt, oldValue: change.oldValue, newValue: change.newValue,
        appliedAt: new Date().toISOString()
      });
      this.collectImpact(change, aggregate);
    });
    return hadConflict ? 'conflict' : 'merged';
  }

  private collectImpact(
    change: RevisionChange,
    aggregate: { locales: Set<string>; roles: Set<RoleReview['role']> }
  ): void {
    const { locales, roles } = this.changeImpact(change);
    locales.forEach((locale) => aggregate.locales.add(locale));
    roles.forEach((role) => aggregate.roles.add(role));
  }

  private finalizeMerge(
    draft: NoticeDraft,
    merge: OfflineMergeState,
    locales: Set<string>,
    roles: Set<RoleReview['role']>
  ): void {
    merge.affectedLocales = [...new Set([...merge.affectedLocales, ...locales])];
    merge.invalidatedRoles = [...new Set([...merge.invalidatedRoles, ...roles])];
    // 字段改动后：受影响语言的翻译复核失效，责任角色需重新确认，发布前检查整体重做。
    draft.languages.forEach((language) => {
      if (merge.affectedLocales.includes(language.id)) language.reviewed = false;
    });
    draft.reviews.forEach((review) => {
      if (merge.invalidatedRoles.includes(review.role)) {
        review.status = 'pending';
        review.note = review.note ? `${review.note}（离线合入后需重新确认）` : '离线合入改动了相关内容，待重新确认。';
      }
    });
    merge.checksReconfirmed = false;
    draft.status = 'pending-review';
    draft.lockedAt = undefined;
    if (!draft.version.endsWith('-merge-review')) {
      draft.version = `${merge.baseVersion}-merge-review`;
    }
  }

  // ───────────────────────── 冲突裁决与复核 ─────────────────────────

  fieldLabel(field: RevisionField, locale?: string): string {
    const languageName = locale ? this.localeName(locale) : '';
    switch (field) {
      case 'title': return '共享标题';
      case 'scope': return '影响范围';
      case 'langTitle': return `${languageName}标题`;
      case 'langBody': return `${languageName}正文`;
    }
  }

  localeName(locale: string): string {
    return this.locales.find((item) => item.id === locale)?.name ?? locale;
  }

  changeImpact(change: { field: RevisionField; locale?: string }): { locales: string[]; roles: RoleReview['role'][] } {
    const allLocales = this.draft.languages.map((language) => language.id);
    switch (change.field) {
      case 'title':
        // 共享标题变化影响所有语言版本，编辑与翻译都要重新确认。
        return { locales: allLocales, roles: ['编辑', '翻译'] };
      case 'scope':
        return { locales: [], roles: ['编辑', '发布人'] };
      case 'langTitle':
        return { locales: change.locale ? [change.locale] : [], roles: ['翻译'] };
      case 'langBody':
        return { locales: change.locale ? [change.locale] : [], roles: ['编辑', '法务', '翻译'] };
    }
  }

  private changeIdentity(change: { field: RevisionField; locale?: string }): string {
    return `${change.field}:${change.locale ?? ''}`;
  }

  private readVersionValue(version: VersionSnapshot, field: RevisionField, locale?: string): string {
    if (field === 'title') return version.title;
    if (field === 'scope') return version.scope;
    const language = version.languages.find((item) => item.id === locale);
    if (!language) return '';
    return field === 'langTitle' ? language.title : language.body;
  }

  private readDraftValue(draft: NoticeDraft, field: RevisionField, locale?: string): string {
    if (field === 'title') return draft.title;
    if (field === 'scope') return draft.scope;
    const language = draft.languages.find((item) => item.id === locale);
    if (!language) return '';
    return field === 'langTitle' ? language.title : language.body;
  }

  private writeDraftValue(draft: NoticeDraft, field: RevisionField, locale: string | undefined, value: string): void {
    if (field === 'title') {
      draft.title = value;
      return;
    }
    if (field === 'scope') {
      draft.scope = value;
      return;
    }
    const language = draft.languages.find((item) => item.id === locale);
    if (language) {
      if (field === 'langTitle') language.title = value;
      else language.body = value;
    }
  }

  resolveConflictWithValue(conflict: PendingConflict, value: ConflictValue): void {
    this.commit((draft) => {
      const merge = draft.offlineMerge;
      if (!merge) return;
      const base = draft.versions.find((version) => version.id === merge.baseVersionId);
      this.writeDraftValue(draft, conflict.field, conflict.locale, value.newValue);
      merge.appliedChanges.push({
        field: conflict.field, locale: conflict.locale,
        packageId: value.isBase ? `base:${merge.baseVersionId}` : value.packageId,
        author: value.author, device: value.device, createdAt: value.createdAt,
        oldValue: base ? this.readVersionValue(base, conflict.field, conflict.locale) : '',
        newValue: value.newValue, appliedAt: new Date().toISOString(),
        resolution: value.isBase ? '保留待复核稿现值' : `裁决采用 ${value.author} 的新值`
      });
      merge.conflicts = merge.conflicts.filter((item) => this.changeIdentity(item) !== this.changeIdentity(conflict));
      const impact = this.changeImpact(conflict);
      this.finalizeMerge(draft, merge, new Set(impact.locales), new Set(impact.roles));
    });
    this.toastr.success(`已采用“${this.fieldLabel(conflict.field, conflict.locale)}”的选定值。`, '冲突已裁决');
    if (!this.pendingConflictCount) this.toastr.info('所有冲突已处理，完成检查复核和角色重确认后即可锁定。', '待决冲突清空');
  }

  resolveConflictWithManual(conflict: PendingConflict): void {
    this.commit((draft) => {
      const merge = draft.offlineMerge;
      if (!merge) return;
      // 值班员可在编写页手工调和；以当前稿上的值作为最终裁决。
      const currentValue = this.readDraftValue(draft, conflict.field, conflict.locale);
      merge.appliedChanges.push({
        field: conflict.field, locale: conflict.locale,
        packageId: uid('manual-resolution'), author: '值班员', device: '值班工作台',
        createdAt: new Date().toISOString(), oldValue: '', newValue: currentValue,
        appliedAt: new Date().toISOString(), resolution: '值班员手工调和后的内容'
      });
      merge.conflicts = merge.conflicts.filter((item) => this.changeIdentity(item) !== this.changeIdentity(conflict));
      const impact = this.changeImpact(conflict);
      this.finalizeMerge(draft, merge, new Set(impact.locales), new Set(impact.roles));
    });
    this.toastr.success('已按编写页中的当前内容裁决，可在编写页继续微调。', '冲突已裁决');
  }

  editConflictInCompose(conflict: PendingConflict): void {
    if (conflict.locale) this.selectedLanguageId = conflict.locale;
    this.activeView = 'compose';
    this.toastr.info('请在编写页调和内容，完成后回到本页点击“采用编写页当前内容”。', '手工调和');
  }

  reconfirmChecks(): void {
    if (this.hasMergeConflicts) {
      this.toastr.warning('仍有待决冲突，请先裁决再复核检查。', '检查复核被阻止');
      return;
    }
    this.commit((draft) => {
      if (draft.offlineMerge) draft.offlineMerge.checksReconfirmed = true;
    });
    this.toastr.success('值班员已确认合入后的发布前检查结果。', '检查已复核');
  }

  abandonMerge(): void {
    const merge = this.draft.offlineMerge;
    if (!merge) return;
    const restore = merge.restore;
    this.commit((draft) => {
      draft.title = restore.title;
      draft.eventType = restore.eventType;
      draft.severity = restore.severity;
      draft.scope = restore.scope;
      draft.channels = [...restore.channels];
      draft.eventAt = restore.eventAt;
      draft.effectiveAt = restore.effectiveAt;
      draft.expiresAt = restore.expiresAt;
      draft.languages = clone(restore.languages);
      draft.reviews = clone(restore.reviews);
      draft.version = restore.version;
      draft.lockedAt = restore.lockedAt;
      draft.status = 'locked';
      draft.offlineMerge = null;
    });
    this.toastr.warning('已放弃全部离线改动，草稿还原为锁定稿，可重新选择修订包导入。', '合并已放弃');
  }

  outcomeLabel(outcome: ImportOutcome): string {
    switch (outcome) {
      case 'merged': return '已合入';
      case 'conflict': return '含冲突';
      case 'duplicate': return '重复忽略';
      case 'stale': return '基础版本过期';
      case 'corrupt': return '包损坏';
      case 'empty': return '空包';
    }
  }

  private summarizeOutcomes(
    validated: Array<{ kind: string }>,
    ok: OfflineRevisionPackage[]
  ): Record<'merged' | 'conflict' | 'stale' | 'corrupt' | 'duplicate', number> {
    const result = {
      merged: 0, conflict: 0,
      stale: validated.filter((item) => item.kind === 'stale').length,
      corrupt: validated.filter((item) => item.kind === 'corrupt').length,
      duplicate: validated.filter((item) => item.kind === 'duplicate').length
    };
    const conflictPackageIds = new Set(
      this.draft.offlineMerge?.conflicts.flatMap((conflict) =>
        conflict.values.filter((value) => !value.isBase).map((value) => value.packageId)
      ) ?? []
    );
    ok.forEach((pkg) => {
      if (conflictPackageIds.has(pkg.packageId)) result.conflict += 1;
      else if (pkg.changes.length) result.merged += 1;
    });
    return result;
  }

  formatDateTime(value: string): string {
    if (!value) return '未设置';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('zh-CN', {
      month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false
    }).format(date);
  }

  trackById(_index: number, item: { id: string }): string {
    return item.id;
  }

  private commit(mutator: (draft: NoticeDraft) => void): void {
    this.history.push(clone(this.draft));
    if (this.history.length > 50) this.history.shift();
    const next = clone(this.draft);
    mutator(next);
    next.updatedAt = new Date().toISOString();
    this.draft = next;
    this.future = [];
    this.persist();
  }

  private persist(): void {
    this.lastSavedAt = this.formatDateTime(new Date().toISOString());
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...this.draft, updatedAt: new Date().toISOString() }));
  }

  private migrate(value: NoticeDraft): NoticeDraft {
    if (!value.id || !Array.isArray(value.languages) || !Array.isArray(value.versions)) return initialDraft();
    value.discussions ??= [];
    value.reviews ??= [];
    value.requiredLocales ??= ['zh-CN'];
    // 旧版数据升级：没有离线修订包字段的草稿一律视为无合并在途。
    value.offlineMerge ??= null;
    value.rejectedImports ??= [];
    value.emergencyRevision ??= false;
    // 合并状态在锁定后应已清空；脏数据下也要恢复成可编辑草稿。
    if (value.status === 'pending-review' && !value.offlineMerge) value.status = 'draft';
    return value;
  }

  private splitSentences(text: string): string[] {
    return (text.match(/[^。！？.!?]+[。！？.!?]?/g) ?? []).map((item) => item.trim()).filter(Boolean);
  }

  private toTime(value: string): number {
    const time = new Date(value).getTime();
    return Number.isNaN(time) ? 0 : time;
  }

  private diffSentences(left: string[], right: string[]): DiffRow[] {
    const rows: DiffRow[] = [];
    const lcs: number[][] = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
    for (let i = left.length - 1; i >= 0; i--) {
      for (let j = right.length - 1; j >= 0; j--) {
        lcs[i][j] = left[i] === right[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < left.length || j < right.length) {
      if (i < left.length && j < right.length && left[i] === right[j]) {
        rows.push({ left: left[i], right: right[j], kind: 'same' }); i++; j++;
      } else if (i < left.length && j < right.length && lcs[i + 1][j] === lcs[i][j] && lcs[i][j + 1] === lcs[i][j]) {
        rows.push({ left: left[i], right: right[j], kind: 'changed' }); i++; j++;
      } else if (j < right.length && (i === left.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
        rows.push({ left: '', right: right[j], kind: 'added' }); j++;
      } else if (i < left.length) {
        rows.push({ left: left[i], right: '', kind: 'removed' }); i++;
      }
    }
    return rows;
  }
}
