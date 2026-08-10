# @milkdown/crepe

Crepe 编辑器，构建于 milkdown 之上。

## 功能

Crepe 提供了一组丰富的功能，可以通过配置启用或禁用。默认情况下，除 `TopBar` 和 `AI` 外，大部分功能都是启用的：

```typescript
const defaultFeatures: Record<CrepeFeature, boolean> = {
  [Crepe.Feature.Cursor]: true,
  [Crepe.Feature.ListItem]: true,
  [Crepe.Feature.LinkTooltip]: true,
  [Crepe.Feature.ImageBlock]: true,
  [Crepe.Feature.BlockEdit]: true,
  [Crepe.Feature.Placeholder]: true,
  [Crepe.Feature.Toolbar]: true,
  [Crepe.Feature.CodeMirror]: true,
  [Crepe.Feature.Table]: true,
  [Crepe.Feature.Latex]: true,
  [Crepe.Feature.TopBar]: false,
  [Crepe.Feature.AI]: false,
}
```

你可以在 `features` 配置中将特定功能设为 `false` 来禁用它们。

## 图标配置

许多功能允许自定义其图标。你可以以字符串形式提供图标：

```typescript
const config: CrepeConfig = {
  featureConfigs: {
    [Crepe.Feature.Toolbar]: {
      boldIcon: '<svg>...</svg>',
      italicIcon: '<svg>...</svg>',
    },
  },
}
```

## 配置

Crepe 编辑器可以通过 `CrepeConfig` 接口进行配置：

```typescript
interface CrepeConfig {
  features?: Partial<Record<CrepeFeature, boolean>> // 启用/禁用特定功能
  featureConfigs?: CrepeFeatureConfig // 配置各个功能
  root?: Node | string | null // 编辑器的根元素
  defaultValue?: DefaultValue // 初始内容
}
```

### 构建器配置

`CrepeBuilder` 可以通过 `CrepeBuilderConfig` 接口进行配置：

```typescript
interface CrepeBuilderConfig {
  /// 编辑器的根元素。
  /// 同时支持 DOM 节点和 CSS 选择器，
  /// 若未提供，编辑器将附加到 body。
  root?: Node | string | null

  /// 编辑器的默认值。
  defaultValue?: DefaultValue
}
```

### 功能配置

每个功能都可以单独配置。以下是每个功能可用的配置：

#### 光标功能

```typescript
interface CursorFeatureConfig {
  color?: string | false // 自定义光标颜色
  width?: number // 光标宽度（像素）
  virtual?: boolean // 启用/禁用虚拟光标
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.Cursor]: true,
  },
  featureConfigs: {
    [Crepe.Feature.Cursor]: {
      color: '#ff0000',
      width: 2,
      virtual: true,
    },
  },
}
```

#### 列表项功能

```typescript
interface ListItemFeatureConfig {
  bulletIcon?: string // 自定义无序列表图标
  checkBoxCheckedIcon?: string // 自定义已勾选复选框图标
  checkBoxUncheckedIcon?: string // 自定义未勾选复选框图标
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.ListItem]: true,
  },
  featureConfigs: {
    [Crepe.Feature.ListItem]: {
      bulletIcon: customBulletIcon,
      checkBoxCheckedIcon: customCheckedIcon,
      checkBoxUncheckedIcon: customUncheckedIcon,
    },
  },
}
```

#### 链接提示功能

```typescript
interface LinkTooltipFeatureConfig {
  linkIcon?: string // 自定义链接图标
  editButton?: string // 自定义编辑按钮图标
  removeButton?: string // 自定义移除按钮图标
  confirmButton?: string // 自定义确认按钮图标
  inputPlaceholder?: string // 链接输入框的占位文本
  onCopyLink?: (link: string) => void // 链接被复制时的回调
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.LinkTooltip]: true,
  },
  featureConfigs: {
    [Crepe.Feature.LinkTooltip]: {
      inputPlaceholder: 'Enter URL...',
      onCopyLink: () => console.log('Link copied'),
    },
  },
}
```

#### 图片块功能

```typescript
interface ImageBlockFeatureConfig {
  // 行内图片配置
  inlineUploadButton?: string
  inlineImageIcon?: string
  inlineConfirmButton?: string
  inlineUploadPlaceholderText?: string
  inlineOnUpload?: (file: File) => Promise<string>

  // 块级图片配置
  blockUploadButton?: string
  blockImageIcon?: string
  blockCaptionIcon?: string
  blockConfirmButton?: string
  blockCaptionPlaceholderText?: string
  blockUploadPlaceholderText?: string
  blockOnUpload?: (file: File) => Promise<string>

  // 通用配置
  onUpload?: (file: File) => Promise<string>
  proxyDomURL?: string
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.ImageBlock]: true,
  },
  featureConfigs: {
    [Crepe.Feature.ImageBlock]: {
      inlineUploadButton: 'Upload Image',
      blockCaptionPlaceholderText: 'Add image caption...',
      onUpload: async (file) => {
        // 处理文件上传
        return 'https://example.com/image.jpg'
      },
    },
  },
}
```

> **注意**：`onUpload` 回调同时用于点击上传按钮和拖拽文件上传。
> Crepe 内置了一个上传插件（`@milkdown/plugin-upload`），用于处理拖拽和粘贴图片上传。
> 当 `ImageBlock` 功能启用时，上传插件会使用图片块配置中的 `onUpload` 来处理文件并创建 `image-block` 节点。
> 如果未提供自定义的 `onUpload`，文件默认会被转换为本地 blob URL。

#### 块编辑功能

```typescript
interface BlockEditFeatureConfig {
  // 块操作手柄图标
  handleAddIcon?: string
  handleDragIcon?: string

  // 块操作手柄配置
  blockHandle?: {
    // 用于判断是否显示块操作手柄的函数。
    shouldShow?: (view: EditorView) => boolean
    // 用于配置块操作手柄偏移量的函数。
    getOffset?: (deriveContext: DeriveContext) => {
      mainAxis?: number
      crossAxis?: number
    }
    // 用于获取块操作手柄位置的函数。
    getPosition?: (deriveContext: DeriveContext) => DOMRect
    // 用于获取块操作手柄放置方位的函数。
    getPlacement?: (
      deriveContext: DeriveContext
    ) => 'top' | 'bottom' | 'left' | 'right'
    // floating-ui 中间件数组。
    middleware?: unknown[]
    // floating-ui 的附加选项。
    floatingUIOptions?: unknown
    // 块操作手柄的根元素。
    root?: HTMLElement
  }

  // 菜单配置
  buildMenu?: (builder: GroupBuilder<SlashMenuItem>) => void

  // 文本分组配置
  textGroup?: {
    label?: string
    text?: {
      label?: string
      icon?: string
    } | null
    h1?: {
      label?: string
      icon?: string
    } | null
    h2?: {
      label?: string
      icon?: string
    } | null
    h3?: {
      label?: string
      icon?: string
    } | null
    h4?: {
      label?: string
      icon?: string
    } | null
    h5?: {
      label?: string
      icon?: string
    } | null
    h6?: {
      label?: string
      icon?: string
    } | null
    quote?: {
      label?: string
      icon?: string
    } | null
    divider?: {
      label?: string
      icon?: string
    } | null
  } | null

  // 列表分组配置
  listGroup?: {
    label?: string
    bulletList?: {
      label?: string
      icon?: string
    } | null
    orderedList?: {
      label?: string
      icon?: string
    } | null
    taskList?: {
      label?: string
      icon?: string
    } | null
  } | null

  // 高级分组配置
  advancedGroup?: {
    label?: string
    image?: {
      label?: string
      icon?: string
    } | null
    codeBlock?: {
      label?: string
      icon?: string
    } | null
    table?: {
      label?: string
      icon?: string
    } | null
    math?: {
      label?: string
      icon?: string
    } | null
  } | null
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.BlockEdit]: true,
  },
  featureConfigs: {
    [Crepe.Feature.BlockEdit]: {
      handleAddIcon: customAddIcon,
      handleDragIcon: customDragIcon,
      blockHandle: {
        getPlacement: () => 'left-start',
      },
      textGroup: {
        label: 'Text Blocks',
        text: {
          label: 'Normal Text',
          icon: customTextIcon,
        },
        h1: {
          label: 'Heading 1',
          icon: customH1Icon,
        },
        h2: null,
        h3: null,
        h4: null,
        h5: null,
        h6: null,
      },
      listGroup: {
        label: 'Lists',
        bulletList: {
          label: 'Bullet List',
          icon: customBulletIcon,
        },
        orderedList: null,
        taskList: null,
      },
      advancedGroup: {
        label: 'Advanced',
        image: {
          label: 'Image',
          icon: customImageIcon,
        },
        codeBlock: null,
        table: null,
        math: null,
      },
      buildMenu: (builder) => {
        // 自定义菜单构建逻辑
      },
    },
  },
}
```

> **注意**：将任意分组或条目设为 `null` 会使其不在菜单中显示。这适用于自定义向用户展示哪些选项。例如，设置 `h2: null` 会隐藏 H2 标题选项，设置 `textGroup: null` 会隐藏整个文本分组。

#### 工具栏功能

```typescript
interface ToolbarFeatureConfig {
  boldIcon?: string
  codeIcon?: string
  italicIcon?: string
  linkIcon?: string
  strikethroughIcon?: string
  latexIcon?: string
  aiIcon?: string // 仅覆盖工具栏中的 AI 按钮（仅在 AI 启用且配置了 provider 时渲染）
  // 无障碍名称，用于本地化。默认值均为其英文标签。
  boldLabel?: string
  codeLabel?: string
  italicLabel?: string
  linkLabel?: string
  strikethroughLabel?: string
  latexLabel?: string
  aiLabel?: string
  buildToolbar?: (builder: GroupBuilder<ToolbarItem>) => void
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.Toolbar]: true,
  },
  featureConfigs: {
    [Crepe.Feature.Toolbar]: {
      boldIcon: customBoldIcon,
      italicIcon: customItalicIcon,
      boldLabel: 'Fett',
      buildToolbar: (builder) => {
        // 自定义工具栏构建逻辑
      },
    },
  },
}
```

每个工具栏按钮都带有一个无障碍名称和一个稳定的 key 进行渲染：

```typescript
type ToolbarItem = {
  active: (ctx: Ctx) => boolean
  icon: string
  label?: string // title + aria-label
  keymap?: KeymapRef // 快捷键绑定的位置；以下两个字段均由此派生
  shortcut?: string // 仅用于显示，追加到 title 后
  ariaKeyshortcuts?: string // aria-keyshortcuts，遵循 ARIA 语法
}
```

`label` 是按钮名称的来源——按钮唯一的其他内容是一个 SVG。

快捷键有两类读取方。`shortcut` 是用户在 tooltip 中看到的内容，因此是 `⌘B` 或 `Ctrl+B`。`ariaKeyshortcuts` 进入 `aria-keyshortcuts` 属性，该属性有明确定义的语法：由 `Alt`、`Control`、`Shift`、`Meta` 和 `AltGraph` 组成的以 `+` 连接的修饰键，再加上一个 `KeyboardEvent.key` 的值。显示用的字形和缩写 `Ctrl` 在那里都是无效的，因此一个字段无法同时服务两者。

你不应手写其中任何一个。快捷键只在一个地方绑定——即它的 keymap——因此用 `keymap` 将条目指向该 keymap，两个字符串就会按平台为你派生，并在宿主重新绑定按键时保持正确。内置的格式按钮已经这样做了，而一个有 keymap 的命令的自定义按钮也如此：

```typescript
import { keymapRef } from '@milkdown/crepe/feature/toolbar'
import { strongKeymap } from '@milkdown/kit/preset/commonmark'

// 为已有命令添加第二个入口会复用同一绑定——无需
// 在此处或它出现的任何地方重新书写 ⌘B。
builder.addGroup('custom', 'Custom').addItem('bold', {
  icon: boldIcon,
  label: 'Bold',
  keymap: keymapRef(strongKeymap.key, 'ToggleBold'),
  active: (ctx) => isBoldActive(ctx),
  onRun: (ctx) => toggleBold(ctx),
})
```

当显式设置时，`shortcut` / `ariaKeyshortcuts` 会覆盖派生值——这是为没有 milkdown keymap 支撑的快捷键准备的逃生通道：

```typescript
builder.addGroup('custom', 'Custom').addItem('highlight', {
  icon: highlightIcon,
  label: 'Highlight',
  shortcut: isMac ? '⌘⇧H' : 'Ctrl+Shift+H', // 展示给用户
  ariaKeyshortcuts: isMac ? 'Meta+Shift+H' : 'Control+Shift+H', // 用于辅助技术（AT）
  active: (ctx) => isHighlightActive(ctx),
  onRun: (ctx) => toggleHighlight(ctx),
})
```

按钮还带有 `data-toolbar-item="<key>"`，因此使用者可以在不依赖其位置的情况下定位某个具体的按钮。

#### 顶栏功能

固定在编辑器顶部的一个工具栏，带有标题选择器、格式按钮、插入操作和块命令。与工具栏功能（在选中文本时以浮动 tooltip 形式出现）不同，顶栏始终可见。该功能**默认禁用**。

```typescript
interface TopBarFeatureConfig {
  // 标题选择器选项
  headingOptions?: HeadingOption[]

  // 图标覆盖
  boldIcon?: string
  italicIcon?: string
  strikethroughIcon?: string
  codeIcon?: string
  linkIcon?: string
  imageIcon?: string
  tableIcon?: string
  codeBlockIcon?: string
  mathIcon?: string
  quoteIcon?: string
  hrIcon?: string
  bulletListIcon?: string
  orderedListIcon?: string
  taskListIcon?: string
  chevronDownIcon?: string

  // 自定义工具栏构建
  buildTopBar?: (builder: GroupBuilder<TopBarItem>) => void
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.TopBar]: true,
  },
  featureConfigs: {
    [Crepe.Feature.TopBar]: {
      // 自定义标题选项
      headingOptions: [
        { label: 'Text', level: null },
        { label: 'H1', level: 1 },
        { label: 'H2', level: 2 },
        { label: 'H3', level: 3 },
      ],
    },
  },
}
```

顶栏支持可配置的下拉选择器。标题选择器是内置的，但你可以通过 `buildTopBar` 添加自定义下拉：

```typescript
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.TopBar]: true,
  },
  featureConfigs: {
    [Crepe.Feature.TopBar]: {
      buildTopBar: (builder) => {
        builder.addGroup('custom', 'Custom').addItem('font-size', {
          icon: '',
          active: () => false,
          selector: {
            chevronIcon: '<svg>...</svg>',
            activeLabel: (ctx) => '16px',
            options: [
              {
                label: '12px',
                onSelect: (ctx) => {
                  /* 设置字体大小 */
                },
              },
              {
                label: '14px',
                onSelect: (ctx) => {
                  /* 设置字体大小 */
                },
              },
              {
                label: '16px',
                onSelect: (ctx) => {
                  /* 设置字体大小 */
                },
              },
            ],
          },
        })
      },
    },
  },
}
```

默认的工具栏分组为：

1. **标题** - 段落/H1-H6 的下拉选择器
2. **格式** - 加粗、斜体、删除线、行内代码
3. **列表** - 无序列表、有序列表、任务列表
4. **插入** - 链接、图片、表格
5. **块** - 代码块、数学公式（LaTeX）
6. **更多** - 引用、水平分割线

#### CodeMirror 功能

```typescript
interface CodeMirrorFeatureConfig {
  extensions?: Extension[] // 自定义 CodeMirror 扩展
  languages?: LanguageDescription[] // 可用语言
  theme?: Extension // CodeMirror 主题

  // UI 自定义
  expandIcon?: string
  searchIcon?: string
  clearSearchIcon?: string
  searchPlaceholder?: string
  noResultText?: string

  // 复制按钮自定义
  copyIcon?: string // 自定义复制按钮图标
  copyText?: string // 自定义复制按钮文本
  onCopy?: (content: string) => void // 代码被复制时的回调

  // 渲染自定义
  renderLanguage?: (language: string, selected: boolean) => string
  renderPreview?: (
    language: string,
    content: string
  ) => string | HTMLElement | null
  previewToggleIcon?: (previewOnlyMode: boolean) => string
  previewToggleText?: (previewOnlyMode: boolean) => string
  previewLabel?: () => string
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.CodeMirror]: true,
  },
  featureConfigs: {
    [Crepe.Feature.CodeMirror]: {
      searchPlaceholder: 'Search programming language...',
      noResultText: 'No matching language found',
      theme: oneDark, // 从 @codemirror/theme-one-dark 导入
    },
  },
}
```

你也可以配置语言列表与主题：

```typescript
import { oneDark } from '@codemirror/theme-one-dark'
import { LanguageDescription } from '@codemirror/language'
import { markdown } from '@codemirror/lang-markdown'

const config: CrepeConfig = {
  features: {
    [Crepe.Feature.CodeMirror]: true,
  },
  featureConfigs: {
    [Crepe.Feature.CodeMirror]: {
      theme: oneDark,
      languages: [
        // 仅加载 markdown 语言
        LanguageDescription.of({
          name: 'Markdown',
          extensions: ['md', 'markdown'],
          load() {
            return import('@codemirror/lang-markdown').then((m) => m.markdown())
          },
        }),
      ],
    },
  },
}
```

要了解有哪些可用语言，可以参考 [CodeMirror language data](https://github.com/codemirror/language-data)。

#### 公式（Latex）功能

```typescript
interface LatexFeatureConfig {
  katexOptions?: KatexOptions // KaTeX 渲染选项
  inlineEditConfirm?: string // 行内数学的自定义确认图标
}

// 示例：
const config: CrepeConfig = {
  features: {
    [Crepe.Feature.Latex]: true,
  },
  featureConfigs: {
    [Crepe.Feature.Latex]: {
      katexOptions: {
        throwOnError: false,
        displayMode: true,
      },
    },
  },
}
```

#### AI 功能

AI 功能将流式输入与差异审阅合并为单一工作流。用户提供 `provider`（一个产出 markdown 令牌的异步生成器），其余部分由 Crepe 处理：工具栏入口、带内置建议的指令面板、行内流式指示器，以及用于接受或拒绝结果浮动差异操作面板。

当用户有文本选区时，`runAICmd` 会用 AI 输出替换选中的文本。provider 会在 `AIPromptContext.selection` 中收到选中的文本，以便进行上下文相关的生成。当选区为空时，内容会插入到光标位置。

```typescript
import { Crepe } from '@milkdown/crepe'
import type { AIFeatureConfig } from '@milkdown/crepe/feature/ai'
import { runAICmd, abortAICmd } from '@milkdown/crepe/feature/ai'
import { callCommand } from '@milkdown/kit/utils'

const crepe = new Crepe({
  root: '#editor',
  features: {
    [Crepe.Feature.AI]: true,
  },
  featureConfigs: {
    [Crepe.Feature.AI]: {
      provider: async function* (context, signal) {
        // 从你的 LLM 产出 markdown 令牌
      },
      diffReviewOnEnd: true,
      diff: { acceptLabel: 'Yes', rejectLabel: 'No' },
      streaming: { throttleMs: 150 },
      onError: (error) => {
        // 处理 AI 错误（provider 失败、buildContext 错误）。
        // 若未提供，默认使用 console.error。
        showToast(error.message)
      },
    } satisfies AIFeatureConfig,
  },
})
await crepe.create()

// 以编程方式触发 AI：
crepe.editor.action(
  callCommand(runAICmd.key, { instruction: 'Summarize this' })
)
// 中止：
crepe.editor.action(callCommand(abortAICmd.key))
```

##### 用户体验界面

当 `Crepe.Feature.AI` 启用且配置了 `provider` 时，该功能会串联起四个 UI 界面：

1. **工具栏 AI 按钮** —— 出现在选区工具栏的“功能”分组中。未配置 `provider` 时隐藏。可通过 `AIFeatureConfig.aiIcon`（全局生效）或 `ToolbarFeatureConfig.aiIcon`（仅工具栏）覆盖图标。
2. **指令面板** —— 从工具栏按钮打开的组合框下拉。用户可以选择内置建议、展开子菜单（如 _更改语气…_、_翻译…_），或输入自由格式的指令并以自定义提示提交。
3. **流式指示器** —— 在流式插入点渲染的行内胶囊，包含旋转加载图标、进行时态标签（如 _正在润色…_）以及 _按 Esc 取消_ 提示。
4. **差异操作面板** —— 当 AI 会话的差异审阅处于活动状态时，固定在编辑器底部的浮动面板。提供 _重试_（对原始范围重新运行相同提示）、_全部拒绝_ 和 _全部接受_ 按钮。_全部接受_ 同时绑定到 <kbd>Mod</kbd>+<kbd>Enter</kbd>。

##### 本地化字符串与覆盖图标

AI 界面使用的每个标签和图标都可配置。以下所有项都位于 `AIFeatureConfig`：

```typescript
interface AIFeatureConfig {
  // ── 指令面板字符串 ───────────────────────────────────
  instructionPlaceholder?: string // 默认值：'Tell AI what to do with the selection…'
  suggestionsHeaderLabel?: string // 默认值：'SUGGESTIONS'
  sendAsPromptHeaderLabel?: string // 默认值：'SEND AS PROMPT'
  sendAsPromptLabel?: string // 默认值：'Ask AI:'
  submitButtonLabel?: string // aria-label，默认值：'Send prompt'
  listboxLabel?: string // aria-label，默认值：'AI suggestions'

  // ── 图标覆盖 ────────────────────────────────────────────────
  aiIcon?: string // 工具栏入口 + 面板前缀
  sendIcon?: string // 圆形提交按钮
  sendPromptIcon?: string // “Ask AI: …” 入口图标
  enterKeyIcon?: string // 指令面板快捷键标签与差异面板共用
  chevronLeftIcon?: string // 子菜单返回箭头
  chevronRightIcon?: string // 子菜单指示图标

  // ── 流式指示器 ───────────────────────────────────────────
  streamingIndicator?: {
    fallbackLabel?: string // 默认值：'Generating'（当 runAICmd 没有 `label` 时使用）
    cancelHint?: string // 默认值：'Esc to cancel'
  }

  // ── 差异操作面板 ────────────────────────────────────────────
  diffActions?: {
    retryLabel?: string // 默认值：'Retry'
    rejectAllLabel?: string // 默认值：'Reject all'
    acceptAllLabel?: string // 默认值：'Accept all'
    retryIcon?: string
    rejectIcon?: string
    acceptIcon?: string
    modSymbol?: string // 默认值：macOS 上为 '⌘'，其他平台为 'Ctrl'
  }
}
```

##### 自定义建议

指令面板内置了若干建议：_改进写作_、_修正语法与拼写_、_更简短_、_更冗长_，以及 _更改语气…_ 和 _翻译…_ 子菜单。可通过 `buildAISuggestions` 自定义该列表：

```typescript
const config: AIFeatureConfig = {
  buildAISuggestions: (builder) => {
    // builder 已预置默认值；可自由修改。
    builder.removeItem('grammar') // 移除一个内置项
    builder.addItem('summarize', {
      icon: '<svg>…</svg>',
      label: 'Summarize',
      streamingLabel: 'Summarizing', // 在流式指示器中显示
      prompt: 'Summarize this in one paragraph.',
    })

    // 添加一个新的子菜单，包含其自身条目
    builder.addSubmenu(
      'audience',
      {
        icon: '<svg>…</svg>',
        label: 'Rewrite for audience…',
        title: 'Rewrite for audience',
        searchPlaceholder: 'Search audiences…',
      },
      (sub) => {
        sub.addItem('beginner', {
          icon: '<svg>…</svg>',
          label: 'Beginners',
          prompt: 'Rewrite this for a beginner audience.',
        })
      }
    )

    // 若要从头开始，先调用 builder.clear()。
  },
}
```

提交的提示会被包裹进一个 `AIPromptContext`（包含序列化后的文档和任意选区），并传给你的 `provider`。

##### 以编程方式触发

```typescript
import { runAICmd, abortAICmd } from '@milkdown/crepe/feature/ai'
import { callCommand } from '@milkdown/kit/utils'

// `label` 是流式指示器中显示的进行时态文本。
crepe.editor.action(
  callCommand(runAICmd.key, {
    instruction: 'Translate this to French',
    label: 'Translating to French',
  })
)

// 中止正在进行的会话。`keep: true` 保留部分
// 流式输出；`keep: false`（默认）丢弃它。
crepe.editor.action(callCommand(abortAICmd.key, { keep: true }))
```

##### 内置 Provider

Crepe 自带两个现成的 `AIProvider` 工厂，因此你无需手工处理 SSE 解析、系统提示或鉴权头。两者都位于各自的子路径下，且不依赖任何 SDK（仅 `fetch`）。

```typescript
import { createOpenAIProvider } from '@milkdown/crepe/llm-providers/openai'
import { createAnthropicProvider } from '@milkdown/crepe/llm-providers/anthropic'

// 服务端形态（无浏览器；`apiKey` 读取自真实密钥）。
// 在浏览器中，参见下文的“部署模式”——传入 `apiKey`
// 来自页面或 Worker 会抛错，除非显式选择加入。
const openai = createOpenAIProvider({
  apiKey: '<your-openai-api-key>',
  model: 'gpt-4o-mini',
})

const anthropic = createAnthropicProvider({
  apiKey: '<your-anthropic-api-key>',
  model: 'claude-sonnet-4-5',
})
```

在浏览器打包产物中嵌入 API 密钥没有“安全”的方式——像 Vite 的 `import.meta.env.VITE_*` 这类构建期替换，最终会以明文形式出现在发布出去的 JavaScript 中，任何能打开开发者工具的人都能看到。两种安全的部署模式是：

- **BYOK**（自带密钥）：每位用户提供自己的密钥（键入你的 UI、从桌面应用钥匙串读取等），并为其自身账号接受暴露风险。设置 `dangerouslyAllowBrowser: true`。
- **后端代理**：完全省略 `apiKey`，将 `baseURL` 指向你自己的服务器，由服务器持有真实密钥并转发请求。这是多用户 Web 应用推荐的模式。

`process.env` 仅在 Node/SSR 中有效；在典型的浏览器构建中不会被定义。

两个 provider 都会发送一条默认的系统提示，要求输出原始 markdown（无前缀、无包裹的代码围栏），并从 `AIPromptContext` 组装用户消息：

```
<document>
{full markdown}
</document>

<selection>            ← 仅在非空时
{selected markdown}
</selection>

<instruction>
{user instruction}
</instruction>
```

###### 部署模式

选择与你 API 密钥实际所处位置相匹配的配置组合：

```typescript
// 1. 桌面端 / BYOK（每位用户提供自己的密钥）
//    密钥在页面中；需显式选择加入。
createOpenAIProvider({
  apiKey: userKey,
  model: 'gpt-4o-mini',
  dangerouslyAllowBrowser: true,
})

// 2. 生产环境：通过你自己的后端转发。
//    不使用 `apiKey`；你的服务器附加真实密钥。浏览器
//    改为发送会话令牌。无需 `dangerouslyAllowBrowser`，
//    因为 API 密钥永远不会到达客户端。
createAnthropicProvider({
  baseURL: '/api/anthropic',
  headers: { Authorization: `Bearer ${sessionToken}` },
  model: 'claude-sonnet-4-5',
})

// 3. 服务端 / SSR
//    无浏览器，因此无需选择加入。
createOpenAIProvider({
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-4o-mini',
})
```

在未设置 `dangerouslyAllowBrowser: true` 的情况下，从浏览器主线程或 Worker 设置 `apiKey` 会抛错——provider 拒绝将你的密钥泄露到任何访客都能读取的上下文中。

###### 共享配置

这两个 provider 共享以下字段（实际导出的类型是 `OpenAIProviderConfig` 和 `AnthropicProviderConfig`；下面的接口仅用于说明——并没有可直接导入的 `BaseProviderConfig` 公共导出）：

```typescript
// OpenAIProviderConfig 与 AnthropicProviderConfig 共享的形状
interface BaseProviderConfig {
  apiKey?: string
  baseURL?: string // 默认为 provider 的官方端点
  headers?: Record<string, string>
  model: string
  systemPrompt?: string | null // string → 原样使用（含 ''）；null → 省略；undefined → 默认值
  dangerouslyAllowBrowser?: boolean
}
```

`systemPrompt` 的语义：`undefined` 保留仅输出 markdown 的默认值，`null` 表示完全不发送系统消息，而任意字符串（包括 `''`）会逐字替换默认值。

###### Provider 特定选项

```typescript
// OpenAI：任何 chat-completions 请求体字段（temperature、top_p 等）
// 都可放入 `body`。`buildMessages` 允许你完全自定义
// 消息数组——默认值会被传入，以便你进行包裹。
// `defaults.systemPrompt` 为 `string | null`：`null` 表示用户
// 要求省略系统消息，因此不要将其强制转为 ''。
createOpenAIProvider({
  apiKey,
  model: 'gpt-4o-mini',
  body: { temperature: 0.2 },
  buildMessages: (context, defaults) => [
    ...(defaults.systemPrompt !== null
      ? [{ role: 'system' as const, content: defaults.systemPrompt }]
      : []),
    { role: 'user', content: defaults.userMessage },
  ],
})

// Anthropic：`maxTokens`（默认 4096）、`anthropicVersion`（默认
// '2023-06-01'），以及通过 `body` 传入的任意 `/v1/messages` 请求体字段。
// `buildMessages` 返回 `{ system, messages }`，因为 Anthropic 将
// 系统提示放在顶层字段，而非消息数组中。
createAnthropicProvider({
  apiKey,
  model: 'claude-sonnet-4-5',
  maxTokens: 2048,
  body: { temperature: 0.5 },
})
```

###### 直接浏览器调用的 CORS 说明

`api.openai.com/v1/chat/completions` 不返回浏览器跨源请求所需的 `Access-Control-Allow-Origin`（ACAO）响应头，而 `api.anthropic.com/v1/messages` 需要 `anthropic-dangerous-direct-browser-access` 响应头（当 `dangerouslyAllowBrowser: true` 时，Anthropic provider 会自动设置）。浏览器直连 provider 在桌面应用（无 CORS）中可以工作，但在普通网页中通常会失败。上面的代理模式（`baseURL` 指向你自己的后端）完全绕开了 CORS，是推荐的部署模式。

底层插件 API 请参见 [@milkdown/plugin-diff](./plugin-diff.md) 和 [@milkdown/plugin-streaming](./plugin-streaming.md)。

##### 从你自己的 UI 驱动 AI 功能

如果你替换了工具栏，有两个 helper 可以帮你复现其 AI 按钮——一个用于判断是否显示，一个用于运行它。它们是分开的调用，因为它们发生在不同时刻：可见性在构建工具栏时评估一次，而选区范围在每次点击时读取。

```typescript
import { editorViewCtx } from '@milkdown/kit/core'
import { CrepeFeature, useCrepeFeatures } from '@milkdown/crepe'
import {
  defaultAIIcon,
  useAIInstructionTooltipAPI,
  useAIProviderConfig,
} from '@milkdown/crepe/feature/ai'

// 可见性——在构建工具栏时评估一次。仅在
// provider 真正配置好时才提供该操作：否则面板
// 会打开，但每个操作都会被拒绝。
const showAIButton = crepe.editor.action((ctx) => {
  // 两个 helper 在 AI 功能禁用时都会抛错，因此先
  // 查询功能标志。
  if (!useCrepeFeatures(ctx).get().includes(CrepeFeature.AI)) return false
  return Boolean(useAIProviderConfig(ctx).provider)
})

// 操作——在点击时读取选区，绝不要提前。
function onAIButtonClick() {
  crepe.editor.action((ctx) => {
    const { from, to } = ctx.get(editorViewCtx).state.selection
    useAIInstructionTooltipAPI(ctx).show(from, to)
  })
}
```

使用 `defaultAIIcon` 以匹配内置按钮的图标。`AIFeatureConfig.aiIcon` 仅覆盖 Crepe 自身的工具栏入口——在 `useAIProviderConfig(ctx)` 上它是 `undefined`（除非宿主设置了它），因此不要依赖它作为你的默认值。

两个 helper 都是按名称（而非按 slice 对象）解析其 slice，这正是它们可以安全地从 `@milkdown/crepe/feature/ai` 导入、而 `Crepe` 来自 `@milkdown/crepe` 的原因：每个包入口是分别打包的，因此两个入口的 slice *对象* 不是同一个实例。

⚠️ `useAIProviderConfig(ctx)` 返回的是实时配置，其 `provider` 在 BYOK 部署中是你 API 密钥的一个闭包。读取你需要的字段；不要记录或序列化整个对象。

## 用法

### 使用 Crepe 编辑器

`Crepe` 类提供了一个高层接口，默认启用所有功能：

```typescript
import { Crepe } from '@milkdown/crepe'

const editor = new Crepe({
  root: '#editor', // DOM 元素或选择器
  features: {
    [Crepe.Feature.Toolbar]: true,
    [Crepe.Feature.Latex]: true,
  },
  featureConfigs: {
    [Crepe.Feature.Placeholder]: {
      text: 'Start writing...',
      mode: 'block',
    },
  },
  defaultValue: '# Hello World',
})

// 获取 markdown 内容
const markdown = editor.getMarkdown()

// 设置只读模式
editor.setReadonly(true)

// 监听编辑器事件
editor.on((listener) => {
  listener.markdownUpdated((ctx, markdown, prevMarkdown) => {
    // 处理更新
  })
})
```

### 使用 CrepeBuilder

`CrepeBuilder` 类提供了一种更灵活的方式来通过手动添加功能构建编辑器。这种方式对于优化打包体积特别有用，因为你只引入实际所需的功能：

```typescript
import { CrepeBuilder } from '@milkdown/crepe/builder'
import { blockEdit } from '@milkdown/crepe/feature/block-edit'
import { toolbar } from '@milkdown/crepe/feature/toolbar'
import { topBar } from '@milkdown/crepe/feature/top-bar'

// 你也可以按功能导入样式
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/block-edit.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import '@milkdown/crepe/theme/common/top-bar.css'

// 引入主题
import '@milkdown/crepe/theme/crepe.css'

const builder = new CrepeBuilder({
  root: '#editor',
  defaultValue: '# Hello World',
})

// 手动添加功能
builder.addFeature(blockEdit).addFeature(toolbar).addFeature(topBar)

// 创建编辑器
const editor = await builder.create()

// 获取 markdown 内容
const markdown = builder.getMarkdown()

// 设置只读模式
builder.setReadonly(true)

// 监听编辑器事件
builder.on((listener) => {
  listener.markdownUpdated((ctx, markdown, prevMarkdown) => {
    // 处理更新
  })
})
```

在以下场景 `CrepeBuilder` 很有用：

- 仅包含所需功能以减小打包体积
- 更好地控制添加哪些功能以及添加顺序
- 添加自定义功能或插件
- 使用各自特定的配置单独配置功能

与使用启用了所有功能的完整 `Crepe` 编辑器相比，这种方式支持更好的 tree-shaking，从而产生更小的打包体积。

## 主题

Crepe 自带多个可导入的内置主题：

```typescript
// 浅色主题
import '@milkdown/crepe/theme/crepe.css'
import '@milkdown/crepe/theme/nord.css'
import '@milkdown/crepe/theme/frame.css'

// 深色主题
import '@milkdown/crepe/theme/crepe-dark.css'
import '@milkdown/crepe/theme/nord-dark.css'
import '@milkdown/crepe/theme/frame-dark.css'
```

### 自定义主题变量

每个主题都在 `.milkdown` 元素上暴露了 CSS 自定义属性，因此你可以在不触碰源码的情况下覆盖它们。例如，用一行代码即可缩放整个编辑器的字号（默认 `16px`）：

```css
.milkdown {
  --crepe-base-font-size: 14px;
}
```

其他变量遵循相同的模式，例如 `--crepe-font-default`、`--crepe-font-title`、`--crepe-font-code` 以及 `--crepe-color-*` 调色板。

## API 参考

@CrepeFeature

@Crepe

@CrepeConfig

@CrepeBuilder

@CrepeBuilderConfig

@useCrepe

@useCrepeFeatures
