import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEventHandler,
  type Ref,
} from "react"

import { cn } from "@/lib/utils"

const LINE_HEIGHT = 26
const DEFAULT_EDITOR_HEIGHT = 384
const EDITOR_BORDER_HEIGHT = 2

interface LineNumberedTextareaProps {
  id: string
  value: string
  placeholder: string
  wrapLines: boolean
  /** 编辑框可占用的最大高度（页面视口内可用空间） */
  maxHeight?: number
  /** 指向编辑框外壳容器（行号列 + textarea 整体），供父级测量布局 */
  ref?: Ref<HTMLDivElement>
  readOnly?: boolean
  onChange?: ChangeEventHandler<HTMLTextAreaElement>
}

function equalHeights(left: number[], right: number[]): boolean {
  return (
    left.length === right.length &&
    left.every((height, index) => height === right[index])
  )
}

/** 带行号的 textarea：默认高度随内容自动撑高，到达 maxHeight 后仅内部滚动。 */
export function LineNumberedTextarea({
  id,
  value,
  placeholder,
  wrapLines,
  maxHeight,
  ref,
  readOnly = false,
  onChange,
}: LineNumberedTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const mirrorRef = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [lineHeights, setLineHeights] = useState<number[]>([])
  const [showVerticalScrollbar, setShowVerticalScrollbar] = useState(false)
  const lines = useMemo(() => value.split("\n"), [value])

  const textareaMaxHeight =
    maxHeight === undefined
      ? undefined
      : Math.max(0, maxHeight - EDITOR_BORDER_HEIGHT)
  const textareaMinHeight =
    textareaMaxHeight === undefined
      ? DEFAULT_EDITOR_HEIGHT
      : Math.min(DEFAULT_EDITOR_HEIGHT, textareaMaxHeight)

  /** 测量逻辑行显示高度（换行时一行可能占多倍行高）。 */
  const measureLineHeights = useCallback(() => {
    const textarea = textareaRef.current
    const mirror = mirrorRef.current
    if (!textarea || !mirror) return
    mirror.style.width = `${textarea.clientWidth}px`
    const nextHeights = Array.from(mirror.children, (element) =>
      Math.max(LINE_HEIGHT, Math.ceil(element.getBoundingClientRect().height)),
    )
    setLineHeights((current) =>
      equalHeights(current, nextHeights) ? current : nextHeights,
    )
    return nextHeights
  }, [])

  /** 刷新高度：内容自然高度超出可用空间时固定为 maxHeight，仅显示垂直滚动条。 */
  const refreshHeight = useCallback(
    (nextHeights?: number[]) => {
      const textarea = textareaRef.current
      const mirror = mirrorRef.current
      if (!textarea || !mirror) return
      const heights =
        nextHeights ??
        Array.from(mirror.children, (element) =>
          Math.max(LINE_HEIGHT, Math.ceil(element.getBoundingClientRect().height)),
        )
      const textareaStyle = getComputedStyle(textarea)
      const mirrorStyle = getComputedStyle(mirror)
      const borderHeight =
        Number.parseFloat(textareaStyle.borderTopWidth) +
        Number.parseFloat(textareaStyle.borderBottomWidth)

      const naturalContentHeight =
        heights.reduce((total, height) => total + height, 0) +
        Number.parseFloat(mirrorStyle.paddingTop) +
        Number.parseFloat(mirrorStyle.paddingBottom)

      const hasHorizontalScrollbar = textarea.scrollWidth > textarea.clientWidth
      const horizontalScrollbarHeight = hasHorizontalScrollbar
        ? textarea.offsetHeight - textarea.clientHeight - borderHeight
        : 0
      const naturalEditorHeight =
        naturalContentHeight + horizontalScrollbarHeight

      const targetHeight = Math.min(
        textareaMaxHeight ?? Number.POSITIVE_INFINITY,
        Math.max(textareaMinHeight, naturalEditorHeight),
      )
      if (Math.abs(textarea.offsetHeight - targetHeight) > 1) {
        textarea.style.height = `${targetHeight}px`
      }

      // 以“去掉横向滚动条占用后的可视高度”为准，避免横向条误触发垂直条
      const showVertical =
        textarea.scrollHeight >
        textarea.clientHeight + horizontalScrollbarHeight + 1
      setShowVerticalScrollbar(showVertical)
    },
    [textareaMaxHeight, textareaMinHeight],
  )

  useLayoutEffect(() => {
    const heights = measureLineHeights()
    refreshHeight(heights)
    setScrollTop(textareaRef.current?.scrollTop ?? 0)
  }, [lines, wrapLines, maxHeight, measureLineHeights, refreshHeight])

  // 换行开关/宽度变化（如窗口缩放改变折行位置）后行高与高度可能失效，重新测量
  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    const observer = new ResizeObserver(() => {
      const heights = measureLineHeights()
      refreshHeight(heights)
    })
    observer.observe(textarea)
    return () => observer.disconnect()
  }, [measureLineHeights, refreshHeight])

  return (
    <div
      ref={ref}
      className={cn(
        "relative flex min-h-96 overflow-hidden rounded-md border focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50",
        readOnly ? "bg-muted/50" : "bg-background",
      )}
      style={{
        maxHeight,
        minHeight:
          maxHeight === undefined
            ? undefined
            : Math.min(DEFAULT_EDITOR_HEIGHT, maxHeight),
      }}
    >
      <div
        aria-hidden="true"
        className="relative w-12 shrink-0 overflow-hidden border-r bg-muted/40 text-right font-mono text-xs leading-6.5 text-muted-foreground select-none"
      >
        <div
          className="absolute inset-x-0 top-0 py-2"
          style={{ transform: `translateY(-${scrollTop}px)` }}
        >
          {lines.map((_, index) => (
            <div
              key={index}
              className="pr-2"
              style={{ height: lineHeights[index] ?? LINE_HEIGHT }}
            >
              {index + 1}
            </div>
          ))}
        </div>
      </div>

      <textarea
        ref={textareaRef}
        id={id}
        value={value}
        readOnly={readOnly}
        onChange={onChange}
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
        placeholder={placeholder}
        spellCheck={false}
        wrap={wrapLines ? "soft" : "off"}
        className={cn(
          "min-h-96 min-w-0 flex-1 resize-none overflow-x-auto border-0 bg-transparent py-2 pl-3 pr-0 font-mono text-sm leading-6.5 outline-none tab-4",
          showVerticalScrollbar ? "overflow-y-scroll" : "overflow-y-hidden",
          wrapLines ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre",
        )}
        style={{
          maxHeight: textareaMaxHeight,
          minHeight: textareaMinHeight,
        }}
      />

      {/* textarea 横向滚动到末尾时浏览器不会保留右内边距，固定留白保证两侧间距一致。 */}
      <div aria-hidden="true" className="w-3 shrink-0" />

      <div
        ref={mirrorRef}
        aria-hidden="true"
        className="invisible pointer-events-none absolute left-12 top-0 overflow-hidden py-2 pl-3 pr-0 font-mono text-sm leading-6.5 tab-4"
      >
        {lines.map((line, index) => (
          <div
            key={index}
            className={cn(
              "min-h-6.5",
              wrapLines ? "whitespace-pre-wrap wrap-break-word" : "whitespace-pre",
            )}
          >
            {line || "\u200b"}
          </div>
        ))}
      </div>
    </div>
  )
}
