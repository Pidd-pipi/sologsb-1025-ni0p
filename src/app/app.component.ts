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
type NoticeStatus = 'draft' | 'in-review' | 'locked';
type CheckLevel = 'error' | 'warning' | 'info';
type ChangeKind = 'meta' | 'language';

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
  updatedAt: string;
  /** 离线修订包合并：待复核稿（冲突裁决前不生成正式新稿）。旧数据无此字段。 */
  pendingReview?: PendingReview;
  /** 已导入过的修订包 ID，用于重复导入识别。 */
  importedPackageIds?: string[];
  /** 字段改动后发布前检查失效，需重新执行确认的时间戳。 */
  checksConfirmedAt?: string;
}

/** 离线修订包：外勤断网期间基于某一锁定稿填写，只携带实际改过的字段。 */
interface RevisionChange {
  key: string;
  kind: ChangeKind;
  locale?: string;
  field: string;
  label: string;
  baseValue: string;
  newValue: string;
}

interface RevisionPackage {
  kind: typeof REVISION_PACKAGE_KIND;
  id: string;
  noticeId: string;
  baseVersionId: string;
  baseVersion: string;
  createdAt: string;
  author: string;
  note?: string;
  changes: RevisionChange[];
  checksum: string;
}

/** 待复核稿中一项无冲突改动。 */
interface PendingChange {
  key: string;
  kind: ChangeKind;
  locale?: string;
  field: string;
  label: string;
  baseValue: string;
  newValue: string;
  packageId: string;
  author: string;
}

/** 同一字段出现两种（及以上）新值时的待决冲突。 */
interface ConflictCandidate {
  packageId: string;
  author: string;
  createdAt: string;
  note?: string;
  value: string;
}

interface PendingConflict {
  id: string;
  key: string;
  kind: ChangeKind;
  locale?: string;
  field: string;
  label: string;
  baseValue: string;
  candidates: ConflictCandidate[];
  selectedPackageId?: string;
  customValue?: string;
}

interface PendingReview {
  id: string;
  createdAt: string;
  baseVersionId: string;
  baseVersion: string;
  packages: RevisionPackage[];
  changes: PendingChange[];
  conflicts: PendingConflict[];
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
const REVISION_PACKAGE_KIND = 'emergency-notice/revision-package';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

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

  // 离线修订包：导入与待复核合并
  importText = '';
  lastImportResult: { ok: boolean; message: string } | null = null;
  // 离线修订包生成器（模拟外勤断网填写）
  builderBaseVersionId = '';
  builderAuthor = '';
  builderNote = '';
  builderTitle = '';
  builderScope = '';
  builderLanguageDrafts: Record<string, { title: string; body: string }> = {};

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
    this.selectBuilderBase(this.draft.versions.at(-1)?.id ?? '');
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
    });
  }

  toggleChannel(channel: string, checked: boolean): void {
    this.commit((draft) => {
      draft.channels = checked ? [...new Set([...draft.channels, channel])] : draft.channels.filter((item) => item !== channel);
    });
  }

  toggleRequiredLocale(locale: string, checked: boolean): void {
    this.commit((draft) => {
      draft.requiredLocales = checked
        ? [...new Set([...draft.requiredLocales, locale])]
        : draft.requiredLocales.filter((item) => item !== locale);
    });
  }

  updateLanguage(field: 'title' | 'body' | 'translator', value: string): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language[field] = value;
    });
  }

  setLanguageReviewed(checked: boolean): void {
    this.commit((draft) => {
      const language = draft.languages.find((item) => item.id === this.selectedLanguageId);
      if (language) language.reviewed = checked;
    });
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
    });
    this.toastr.success(`已应用“${template.name}”模板，请根据事件信息调整。`, '模板复用');
  }

  lockVersion(): void {
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能锁定。`, '发布检查未通过');
      this.activeView = 'checks';
      return;
    }
    if (!this.allReviewsApproved) {
      this.toastr.warning('仍有责任角色未重新确认，不能锁定。', '责任确认未完成');
      this.activeView = 'review';
      return;
    }
    if (this.draft.emergencyRevision && !this.draft.checksConfirmedAt) {
      this.toastr.warning('字段改动后发布前检查已失效，请重新执行检查确认后再锁定。', '检查已失效');
      this.activeView = 'checks';
      return;
    }
    const snapshot: VersionSnapshot = {
      id: uid('version'), label: '最终锁定版本', createdAt: new Date().toISOString(), version: this.nextVersion,
      title: this.draft.title, severity: this.draft.severity, scope: this.draft.scope, eventAt: this.draft.eventAt,
      effectiveAt: this.draft.effectiveAt, expiresAt: this.draft.expiresAt, channels: [...this.draft.channels],
      languages: clone(this.draft.languages), note: '发布前检查通过并锁定。', emergency: false
    };
    this.commit((draft) => {
      draft.versions.push(snapshot);
      draft.version = snapshot.version;
      draft.status = 'locked';
      draft.lockedAt = snapshot.createdAt;
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

  // ── 离线修订包：生成（外勤断网填写） ──────────────────────────────

  get builderBaseSnapshot(): VersionSnapshot | undefined {
    return this.draft.versions.find((version) => version.id === this.builderBaseVersionId) ?? this.draft.versions.at(-1);
  }

  selectBuilderBase(versionId: string): void {
    const snapshot = this.draft.versions.find((version) => version.id === versionId);
    if (!snapshot) return;
    this.builderBaseVersionId = snapshot.id;
    this.builderTitle = snapshot.title;
    this.builderScope = snapshot.scope;
    this.builderLanguageDrafts = {};
    snapshot.languages.forEach((language) => {
      this.builderLanguageDrafts[language.id] = { title: language.title, body: language.body };
    });
  }

  setBuilderLanguage(localeId: string, field: 'title' | 'body', value: string): void {
    const current = this.builderLanguageDrafts[localeId];
    if (!current) return;
    this.builderLanguageDrafts[localeId] = { ...current, [field]: value };
  }

  builderLanguageValue(localeId: string, field: 'title' | 'body'): string {
    return this.builderLanguageDrafts[localeId]?.[field] ?? '';
  }

  /** 与锁定稿相比实际改过的字段；修订包只携带这些字段。 */
  get builderChanges(): RevisionChange[] {
    const snapshot = this.builderBaseSnapshot;
    if (!snapshot) return [];
    const changes: RevisionChange[] = [];
    if (this.builderTitle !== snapshot.title) {
      changes.push({ key: 'meta:title', kind: 'meta', field: 'title', label: '通知标题', baseValue: snapshot.title, newValue: this.builderTitle });
    }
    if (this.builderScope !== snapshot.scope) {
      changes.push({ key: 'meta:scope', kind: 'meta', field: 'scope', label: '影响范围', baseValue: snapshot.scope, newValue: this.builderScope });
    }
    snapshot.languages.forEach((language) => {
      const draft = this.builderLanguageDrafts[language.id];
      if (!draft) return;
      if (draft.title !== language.title) {
        changes.push({
          key: `lang:${language.id}:title`, kind: 'language', locale: language.id, field: 'title',
          label: `${language.name}标题`, baseValue: language.title, newValue: draft.title
        });
      }
      if (draft.body !== language.body) {
        changes.push({
          key: `lang:${language.id}:body`, kind: 'language', locale: language.id, field: 'body',
          label: `${language.name}正文`, baseValue: language.body, newValue: draft.body
        });
      }
    });
    return changes;
  }

  private buildRevisionPackage(): RevisionPackage | null {
    const snapshot = this.builderBaseSnapshot;
    if (!snapshot) return null;
    const changes = this.builderChanges;
    if (!changes.length) {
      this.toastr.warning('当前没有任何改动，修订包为空，不能导出。', '无可合并内容');
      return null;
    }
    const pkg: RevisionPackage = {
      kind: REVISION_PACKAGE_KIND,
      id: uid('pkg'),
      noticeId: this.draft.id,
      baseVersionId: snapshot.id,
      baseVersion: snapshot.version,
      createdAt: new Date().toISOString(),
      author: this.builderAuthor.trim() || '外勤人员',
      note: this.builderNote.trim() || undefined,
      changes,
      checksum: ''
    };
    pkg.checksum = this.checksum(pkg);
    return pkg;
  }

  exportRevisionPackage(): void {
    const pkg = this.buildRevisionPackage();
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `revision-package-${pkg.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    this.toastr.success('修订包已导出，联网后可在「离线合并」中导入。', '离线包已生成');
  }

  copyRevisionPackage(): void {
    const pkg = this.buildRevisionPackage();
    if (!pkg) return;
    const text = JSON.stringify(pkg, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text)
        .then(() => this.toastr.success('修订包 JSON 已复制到剪贴板。', '已复制'))
        .catch(() => this.toastr.info('复制失败，请改用导出包文件。'));
    } else {
      this.toastr.info('当前环境不支持剪贴板，请改用导出包文件。');
    }
  }

  // ── 离线修订包：导入、校验与合并 ─────────────────────────────────

  get pendingReview(): PendingReview | undefined {
    return this.draft.pendingReview;
  }

  get pendingChanges(): PendingChange[] {
    return this.draft.pendingReview?.changes ?? [];
  }

  get pendingConflicts(): PendingConflict[] {
    return this.draft.pendingReview?.conflicts ?? [];
  }

  get pendingPackages(): RevisionPackage[] {
    return this.draft.pendingReview?.packages ?? [];
  }

  get unresolvedConflictCount(): number {
    return this.pendingConflicts.filter((conflict) => !conflict.selectedPackageId && !(conflict.customValue ?? '').trim()).length;
  }

  get allConflictsResolved(): boolean {
    return !!this.draft.pendingReview && this.unresolvedConflictCount === 0;
  }

  onPackageFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      this.importText = String(reader.result ?? '');
      this.importRevisionPackage();
    };
    reader.readAsText(file);
    input.value = '';
  }

  importRevisionPackage(): void {
    const raw = this.importText.trim();
    if (!raw) {
      this.lastImportResult = { ok: false, message: '请先粘贴修订包 JSON 内容，或选择 .json 包文件导入。' };
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.lastImportResult = { ok: false, message: '包损坏：内容不是有效的 JSON，文件可能已损坏或被截断。' };
      return;
    }
    const validation = this.validatePackage(parsed);
    if (!validation.ok) {
      this.lastImportResult = { ok: false, message: validation.message };
      return;
    }
    const pkg = validation.package;
    // 同一包重复导入
    if (this.draft.importedPackageIds?.includes(pkg.id) || this.draft.pendingReview?.packages.some((item) => item.id === pkg.id)) {
      this.lastImportResult = { ok: false, message: `重复导入：修订包 ${pkg.id} 已经导入过，不能重复合并。` };
      return;
    }
    // 基础版本：必须来自当前锁定稿（或待复核稿所基于的锁定稿）
    const expectedBaseId = this.draft.pendingReview?.baseVersionId
      ?? (this.draft.status === 'locked' ? this.draft.versions.at(-1)?.id : undefined);
    if (!expectedBaseId) {
      this.lastImportResult = { ok: false, message: '当前没有可合并的锁定稿：离线修订包必须基于某一锁定版本，请先完成发布检查并锁定。' };
      return;
    }
    if (pkg.noticeId !== this.draft.id) {
      this.lastImportResult = { ok: false, message: `基础版本不匹配：该包属于通知 ${pkg.noticeId}，不是本通知（${this.draft.id}）的修订包。` };
      return;
    }
    if (pkg.baseVersionId !== expectedBaseId) {
      const expected = this.draft.versions.find((version) => version.id === expectedBaseId);
      this.lastImportResult = {
        ok: false,
        message: `基础版本已过期：修订包基于锁定稿 ${pkg.baseVersion}（${pkg.baseVersionId}），当前锁定稿为 ${expected?.version ?? '未知'}（${expectedBaseId}），旧包不能合并到新稿。`
      };
      return;
    }
    // 包内字段原值必须与锁定稿一致，否则包基于其他草稿
    const snapshot = this.draft.versions.find((version) => version.id === pkg.baseVersionId);
    if (!snapshot) {
      this.lastImportResult = { ok: false, message: `基础版本已过期：修订包引用的锁定稿 ${pkg.baseVersion} 不在当前版本链中。` };
      return;
    }
    for (const change of pkg.changes) {
      const expectedValue = this.snapshotValue(snapshot, change);
      if (expectedValue === undefined || expectedValue !== change.baseValue) {
        this.lastImportResult = { ok: false, message: `包损坏：改动「${change.label}」的原值与锁定稿 ${snapshot.version} 不一致，包可能基于其他草稿或已被篡改。` };
        return;
      }
    }
    const { added, conflicts } = this.mergePackage(pkg);
    this.importText = '';
    this.lastImportResult = {
      ok: true,
      message: `导入成功：${pkg.author} 基于锁定稿 ${pkg.baseVersion}，携带 ${pkg.changes.length} 项改动；${added} 项无冲突进入待复核稿，${conflicts} 项与已有改动冲突，已列为待决冲突。`
    };
  }

  selectConflictCandidate(conflict: PendingConflict, packageId: string): void {
    this.commit((draft) => {
      const target = draft.pendingReview?.conflicts.find((item) => item.id === conflict.id);
      if (target) {
        target.selectedPackageId = packageId;
        target.customValue = '';
      }
    });
  }

  setConflictCustom(conflict: PendingConflict, value: string): void {
    this.commit((draft) => {
      const target = draft.pendingReview?.conflicts.find((item) => item.id === conflict.id);
      if (target) {
        target.customValue = value;
        if (value.trim()) target.selectedPackageId = undefined;
      }
    });
  }

  /** 冲突全部裁决后，把待复核稿合并为正式修订稿；处理前不能生成。 */
  applyPendingReview(): void {
    const review = this.draft.pendingReview;
    if (!review) return;
    if (!this.allConflictsResolved) {
      this.toastr.warning(`仍有 ${this.unresolvedConflictCount} 项冲突待决，处理完成后才能生成正式修订稿。`, '冲突未解决');
      return;
    }
    this.commit((draft) => {
      const pending = draft.pendingReview;
      if (!pending) return;
      const applied: Array<{ key: string; kind: ChangeKind; locale?: string; field: string; label: string; value: string }> = [];
      pending.changes.forEach((change) => applied.push({
        key: change.key, kind: change.kind, locale: change.locale, field: change.field, label: change.label, value: change.newValue
      }));
      pending.conflicts.forEach((conflict) => {
        const custom = conflict.customValue?.trim();
        const candidate = conflict.candidates.find((item) => item.packageId === conflict.selectedPackageId);
        const value = custom || candidate?.value;
        if (value == null) return;
        applied.push({ key: conflict.key, kind: conflict.kind, locale: conflict.locale, field: conflict.field, label: conflict.label, value });
      });

      const affectedLocales = new Set<string>();
      let metaChanged = false;
      applied.forEach((item) => {
        if (item.kind === 'meta') {
          (draft as unknown as Record<string, string>)[item.field] = item.value;
          metaChanged = true;
        } else {
          const language = draft.languages.find((item2) => item2.id === item.locale);
          if (!language) return;
          (language as unknown as Record<string, string>)[item.field] = item.value;
          language.reviewed = false;
          affectedLocales.add(item.locale ?? '');
        }
      });

      // 锁定稿 → 修订稿：版本号推进，原锁定版本完整保留
      if (draft.status === 'locked') {
        const [major = 1, minor = 0] = draft.version.split('-')[0].split('.').map(Number);
        draft.version = `${major}.${minor + 1}.0-emergency`;
        draft.lockedAt = undefined;
      }
      draft.status = 'draft';
      draft.emergencyRevision = true;
      // 发布前检查失效，需重新执行确认
      draft.checksConfirmedAt = undefined;
      // 责任角色按受影响范围重新确认
      const rolesToReset = new Set<RoleReview['role']>();
      if (metaChanged) rolesToReset.add('编辑');
      if (applied.some((item) => item.kind === 'language')) {
        rolesToReset.add('法务');
        rolesToReset.add('翻译');
      }
      rolesToReset.add('发布人');
      draft.reviews.forEach((reviewItem) => {
        if (rolesToReset.has(reviewItem.role)) reviewItem.status = 'pending';
      });
      draft.pendingReview = undefined;
    });
    this.activeView = 'checks';
    this.toastr.success('离线改动已合并为正式修订稿：受影响语言已失效、发布前检查已失效，相关角色重新确认后才能再次锁定。', '已生成修订稿');
  }

  /** 字段改动后发布前检查失效，值班员重新执行并确认。 */
  reconfirmChecks(): void {
    if (this.blockingChecks.length) {
      this.toastr.warning(`仍有 ${this.blockingChecks.length} 项阻断问题，不能确认检查结果。`, '检查未通过');
      return;
    }
    this.commit((draft) => {
      draft.checksConfirmedAt = new Date().toISOString();
    });
    this.toastr.success('发布前检查已重新确认。', '检查有效');
  }

  private validatePackage(value: unknown): { ok: true; package: RevisionPackage } | { ok: false; message: string } {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { ok: false, message: '包损坏：修订包必须是 JSON 对象。' };
    }
    const source = value as Record<string, unknown>;
    if (source.kind !== REVISION_PACKAGE_KIND) {
      return { ok: false, message: '包损坏：缺少修订包标识（kind），不是本工具生成的修订包。' };
    }
    const nonEmptyString = (item: unknown): item is string => typeof item === 'string' && item.trim().length > 0;
    if (!nonEmptyString(source.id) || !nonEmptyString(source.noticeId) || !nonEmptyString(source.baseVersionId)
      || !nonEmptyString(source.baseVersion) || !nonEmptyString(source.createdAt) || !nonEmptyString(source.author)) {
      return { ok: false, message: '包损坏：修订包缺少必要字段（id、noticeId、baseVersionId、baseVersion、createdAt、author）。' };
    }
    if (!Array.isArray(source.changes)) {
      return { ok: false, message: '包损坏：changes 字段必须是改动数组。' };
    }
    const changes: RevisionChange[] = [];
    for (let index = 0; index < source.changes.length; index++) {
      const rawChange = source.changes[index] as Record<string, unknown>;
      if (typeof rawChange !== 'object' || rawChange === null) {
        return { ok: false, message: `包损坏：第 ${index + 1} 项改动格式不正确。` };
      }
      if (!nonEmptyString(rawChange.key) || !nonEmptyString(rawChange.field) || !nonEmptyString(rawChange.label)
        || typeof rawChange.baseValue !== 'string' || typeof rawChange.newValue !== 'string') {
        return { ok: false, message: `包损坏：第 ${index + 1} 项改动缺少 key、field、label、baseValue 或 newValue。` };
      }
      if (rawChange.kind !== 'meta' && rawChange.kind !== 'language') {
        return { ok: false, message: `包损坏：第 ${index + 1} 项改动的 kind 必须是 meta 或 language。` };
      }
      if (rawChange.kind === 'language' && !nonEmptyString(rawChange.locale)) {
        return { ok: false, message: `包损坏：第 ${index + 1} 项语言改动缺少 locale。` };
      }
      changes.push({
        key: rawChange.key,
        kind: rawChange.kind as ChangeKind,
        locale: typeof rawChange.locale === 'string' ? rawChange.locale : undefined,
        field: rawChange.field,
        label: rawChange.label,
        baseValue: rawChange.baseValue,
        newValue: rawChange.newValue
      });
    }
    if (typeof source.checksum !== 'string' || !source.checksum) {
      return { ok: false, message: '包损坏：缺少校验和 checksum。' };
    }
    const pkg: RevisionPackage = {
      kind: REVISION_PACKAGE_KIND,
      id: source.id,
      noticeId: source.noticeId,
      baseVersionId: source.baseVersionId,
      baseVersion: source.baseVersion,
      createdAt: source.createdAt,
      author: source.author,
      note: typeof source.note === 'string' ? source.note : undefined,
      changes,
      checksum: source.checksum
    };
    if (this.checksum(pkg) !== pkg.checksum) {
      return { ok: false, message: '包损坏：校验和不匹配，包内容可能被篡改或损坏。' };
    }
    if (!changes.length) {
      return { ok: false, message: '空包：修订包内没有任何改动字段，未导入。' };
    }
    return { ok: true, package: pkg };
  }

  private snapshotValue(snapshot: VersionSnapshot, change: RevisionChange): string | undefined {
    if (change.kind === 'meta') {
      return (snapshot as unknown as Record<string, string>)[change.field];
    }
    const language = snapshot.languages.find((item) => item.id === change.locale);
    return language ? (language as unknown as Record<string, string>)[change.field] : undefined;
  }

  /** 把已校验的包合并进待复核稿：同字段同值不冲突，同字段不同值列为冲突。 */
  private mergePackage(pkg: RevisionPackage): { added: number; conflicts: number } {
    let added = 0;
    let conflicts = 0;
    this.commit((draft) => {
      const review: PendingReview = draft.pendingReview
        ? clone(draft.pendingReview)
        : {
          id: uid('pending'),
          createdAt: new Date().toISOString(),
          baseVersionId: pkg.baseVersionId,
          baseVersion: pkg.baseVersion,
          packages: [],
          changes: [],
          conflicts: []
        };
      review.packages.push(clone(pkg));
      for (const change of pkg.changes) {
        const conflict = review.conflicts.find((item) => item.key === change.key);
        if (conflict) {
          if (!conflict.candidates.some((candidate) => candidate.value === change.newValue)) {
            conflict.candidates.push({
              packageId: pkg.id, author: pkg.author, createdAt: pkg.createdAt, note: pkg.note, value: change.newValue
            });
          }
          conflicts++;
          continue;
        }
        const existing = review.changes.find((item) => item.key === change.key);
        if (existing) {
          if (existing.newValue !== change.newValue) {
            review.changes = review.changes.filter((item) => item.key !== change.key);
            review.conflicts.push({
              id: uid('conflict'),
              key: change.key,
              kind: change.kind,
              locale: change.locale,
              field: change.field,
              label: change.label,
              baseValue: change.baseValue,
              candidates: [
                {
                  packageId: existing.packageId,
                  author: existing.author,
                  createdAt: review.packages.find((item) => item.id === existing.packageId)?.createdAt ?? '',
                  value: existing.newValue
                },
                { packageId: pkg.id, author: pkg.author, createdAt: pkg.createdAt, note: pkg.note, value: change.newValue }
              ]
            });
            conflicts++;
          }
          continue;
        }
        review.changes.push({
          key: change.key,
          kind: change.kind,
          locale: change.locale,
          field: change.field,
          label: change.label,
          baseValue: change.baseValue,
          newValue: change.newValue,
          packageId: pkg.id,
          author: pkg.author
        });
        added++;
      }
      draft.pendingReview = review;
      draft.importedPackageIds = [...new Set([...(draft.importedPackageIds ?? []), pkg.id])];
    });
    return { added, conflicts };
  }

  /** 修订包完整性校验（FNV-1a，仅用于识别包损坏/篡改，非加密签名）。 */
  private checksum(pkg: RevisionPackage): string {
    const payload = JSON.stringify({
      id: pkg.id,
      noticeId: pkg.noticeId,
      baseVersionId: pkg.baseVersionId,
      baseVersion: pkg.baseVersion,
      createdAt: pkg.createdAt,
      author: pkg.author,
      note: pkg.note ?? '',
      changes: pkg.changes.map((change) => ({
        key: change.key, kind: change.kind, locale: change.locale ?? '', field: change.field,
        baseValue: change.baseValue, newValue: change.newValue
      }))
    });
    let hash = 0x811c9dc5;
    for (let index = 0; index < payload.length; index++) {
      hash ^= payload.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
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
    value.importedPackageIds ??= [];
    value.emergencyRevision ??= false;
    if (value.pendingReview && (
      typeof value.pendingReview !== 'object' ||
      !Array.isArray(value.pendingReview.packages) ||
      !Array.isArray(value.pendingReview.changes) ||
      !Array.isArray(value.pendingReview.conflicts)
    )) {
      value.pendingReview = undefined;
    }
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
