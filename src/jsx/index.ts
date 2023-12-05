import { raw } from '../helper/html'
import { escapeToBuffer, stringBufferToString } from '../utils/html'
import type { StringBuffer, HtmlEscaped, HtmlEscapedString } from '../utils/html'
import type { IntrinsicElements as IntrinsicElementsDefined } from './intrinsic-elements'
export { ErrorBoundary } from './components'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Props = Record<string, any>

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    type Element = HtmlEscapedString | Promise<HtmlEscapedString>
    interface ElementChildrenAttribute {
      children: Child
    }
    interface IntrinsicElements extends IntrinsicElementsDefined {
      [tagName: string]: Props
    }
  }
}

const emptyTags = [
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]
const booleanAttributes = [
  'allowfullscreen',
  'async',
  'autofocus',
  'autoplay',
  'checked',
  'controls',
  'default',
  'defer',
  'disabled',
  'formnovalidate',
  'hidden',
  'inert',
  'ismap',
  'itemscope',
  'loop',
  'multiple',
  'muted',
  'nomodule',
  'novalidate',
  'open',
  'playsinline',
  'readonly',
  'required',
  'reversed',
  'selected',
]

const childrenToStringToBuffer = (
  children: Child[],
  buffer: StringBuffer,
  emitter?: EventEmitter
): void => {
  for (let i = 0, len = children.length; i < len; i++) {
    const child = children[i]
    if (typeof child === 'string') {
      escapeToBuffer(child, buffer)
    } else if (typeof child === 'boolean' || child === null || child === undefined) {
      continue
    } else if (child instanceof JSXNode) {
      child.toStringWithEmitter(buffer, emitter)
    } else if (
      typeof child === 'number' ||
      (child as unknown as { isEscaped: boolean }).isEscaped
    ) {
      ;(buffer[0] as string) += child
    } else if (child instanceof Promise) {
      buffer.unshift('', child)
    } else {
      // `child` type is `Child[]`, so stringify recursively
      childrenToStringToBuffer(child, buffer)
    }
  }
}

type JSXEventName =
  | 'renderToString'
  | `renderToString.${string}`
  | 'afterRenderToString'
  | `afterRenderToString.${string}`

interface JSXEvent {
  node: JSXNode
  buffer: StringBuffer
  canceled: boolean
  setContent: (content: string | Promise<string>) => void
}
type JSXEventListener = (event: JSXEvent) => void
class EventEmitter {
  #listeners: Record<string, ((event: JSXEvent) => void)[]> = {}
  on(eventName: JSXEventName, listener: JSXEventListener): this {
    ;(this.#listeners[eventName] ||= []).push(listener)
    return this
  }
  emit(eventName: JSXEventName, event: JSXEvent): void {
    ;(this.#listeners[eventName] ||= []).forEach((listener) => listener(event))
  }
}

export type Child = string | Promise<string> | number | JSXNode | Child[]
export class JSXNode implements HtmlEscaped {
  tag: string | Function
  props: Props
  children: Child[]
  isEscaped: true = true as const
  #emitter?: EventEmitter
  constructor(tag: string | Function, props: Props, children: Child[]) {
    this.tag = tag
    this.props = props
    this.children = children
  }

  /**
   * @experimental
   * `on` is an experimental feature.
   * The API might be changed.
   */
  on(event: JSXEventName, listener: JSXEventListener): this {
    this.#emitter ||= new EventEmitter()
    this.#emitter.on(event, listener)
    return this
  }

  toString(): string | Promise<string> {
    const buffer: StringBuffer = ['']
    return this.toStringWithEmitter(buffer, this.#emitter)
  }

  toStringWithEmitter(buffer: StringBuffer, emitter?: EventEmitter): string | Promise<string> {
    let name
    let event: JSXEvent | undefined
    if (emitter) {
      name = typeof this.tag === 'function' ? this.tag.name || '' : this.tag
      event = {
        node: this,
        buffer,
        canceled: false,
        setContent(content: string | Promise<string>) {
          ;(event as JSXEvent).canceled = true
          if (content instanceof Promise) {
            buffer.unshift('', content)
          } else {
            buffer[0] += content
          }
        },
      }
      ;['', `.${name}`].forEach((suffix) => {
        emitter.emit(`renderToString${suffix}` as JSXEventName, event as JSXEvent)
      })
    }
    if (!emitter || !event?.canceled) {
      this.toStringToBuffer(buffer, emitter)
    }
    if (emitter) {
      ;['', `.${name}`].forEach((suffix) => {
        emitter.emit(`afterRenderToString${suffix}` as JSXEventName, event as JSXEvent)
      })
    }
    return buffer.length === 1 ? buffer[0] : stringBufferToString(buffer)
  }

  toStringToBuffer(buffer: StringBuffer, emitter?: EventEmitter): void {
    const tag = this.tag as string
    const props = this.props
    let { children } = this

    buffer[0] += `<${tag}`

    const propsKeys = Object.keys(props || {})

    for (let i = 0, len = propsKeys.length; i < len; i++) {
      const key = propsKeys[i]
      const v = props[key]
      // object to style strings
      if (key === 'style' && typeof v === 'object') {
        const styles = Object.keys(v)
          .map((k) => {
            const property = k.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)
            return `${property}:${v[k]}`
          })
          .join(';')
        buffer[0] += ` style="${styles}"`
      } else if (typeof v === 'string') {
        buffer[0] += ` ${key}="`
        escapeToBuffer(v, buffer)
        buffer[0] += '"'
      } else if (v === null || v === undefined) {
        // Do nothing
      } else if (typeof v === 'number' || (v as HtmlEscaped).isEscaped) {
        buffer[0] += ` ${key}="${v}"`
      } else if (typeof v === 'boolean' && booleanAttributes.includes(key)) {
        if (v) {
          buffer[0] += ` ${key}=""`
        }
      } else if (key === 'dangerouslySetInnerHTML') {
        if (children.length > 0) {
          throw 'Can only set one of `children` or `props.dangerouslySetInnerHTML`.'
        }

        children = [raw(v.__html)]
      } else {
        buffer[0] += ` ${key}="`
        escapeToBuffer(v.toString(), buffer)
        buffer[0] += '"'
      }
    }

    if (emptyTags.includes(tag as string)) {
      buffer[0] += '/>'
      return
    }

    buffer[0] += '>'

    childrenToStringToBuffer(children, buffer, emitter)

    buffer[0] += `</${tag}>`
  }
}

class JSXFunctionNode extends JSXNode {
  toStringToBuffer(buffer: StringBuffer, emitter?: EventEmitter): void {
    const { children } = this

    const res = (this.tag as Function).call(null, {
      ...this.props,
      children: children.length <= 1 ? children[0] : children,
    })

    if (res instanceof Promise) {
      buffer.unshift('', res)
    } else if (res instanceof JSXNode) {
      res.toStringWithEmitter(buffer, emitter)
    } else if (typeof res === 'number' || (res as HtmlEscaped).isEscaped) {
      buffer[0] += res
    } else {
      escapeToBuffer(res, buffer)
    }
  }
}

class JSXFragmentNode extends JSXNode {
  toStringToBuffer(buffer: StringBuffer): void {
    childrenToStringToBuffer(this.children, buffer)
  }
}

export { jsxFn as jsx }
const jsxFn = (
  tag: string | Function,
  props: Props,
  ...children: (string | HtmlEscapedString)[]
): JSXNode => {
  if (typeof tag === 'function') {
    return new JSXFunctionNode(tag, props, children)
  } else {
    return new JSXNode(tag, props, children)
  }
}

/**
 * @experimental
 * `jsxNode` is an experimental feature.
 * The API might be changed.
 * same as `as unknown as JSXNode`
 */
export const jsxNode = (node: HtmlEscaped | Promise<HtmlEscaped>): JSX.Element & JSXNode => {
  if (!(node instanceof JSXNode)) {
    throw new Error('Invalid node')
  }
  return node as JSX.Element & JSXNode
}

export type FC<T = Props> = (
  props: T & { children?: Child }
) => HtmlEscapedString | Promise<HtmlEscapedString>

const shallowEqual = (a: Props, b: Props): boolean => {
  if (a === b) {
    return true
  }

  const aKeys = Object.keys(a)
  const bKeys = Object.keys(b)
  if (aKeys.length !== bKeys.length) {
    return false
  }

  for (let i = 0, len = aKeys.length; i < len; i++) {
    if (a[aKeys[i]] !== b[aKeys[i]]) {
      return false
    }
  }

  return true
}

export const memo = <T>(
  component: FC<T>,
  propsAreEqual: (prevProps: Readonly<T>, nextProps: Readonly<T>) => boolean = shallowEqual
): FC<T> => {
  let computed = undefined
  let prevProps: T | undefined = undefined
  return ((props: T & { children?: Child }): HtmlEscapedString => {
    if (prevProps && !propsAreEqual(prevProps, props)) {
      computed = undefined
    }
    prevProps = props
    return (computed ||= component(props))
  }) as FC<T>
}

export const Fragment = (props: {
  key?: string
  children?: Child | HtmlEscapedString
}): HtmlEscapedString => {
  return new JSXFragmentNode('', {}, props.children ? [props.children] : []) as never
}

export interface Context<T> {
  values: T[]
  Provider: FC<{ value: T }>
}

export const createContext = <T>(defaultValue: T): Context<T> => {
  const values = [defaultValue]
  return {
    values,
    Provider(props): HtmlEscapedString | Promise<HtmlEscapedString> {
      values.push(props.value)
      const string = props.children
        ? (Array.isArray(props.children)
            ? new JSXFragmentNode('', {}, props.children)
            : props.children
          ).toString()
        : ''
      values.pop()

      if (string instanceof Promise) {
        return Promise.resolve().then<HtmlEscapedString>(async () => {
          values.push(props.value)
          const awaited = await string
          const promiseRes = raw(awaited, (awaited as HtmlEscapedString).callbacks)
          values.pop()
          return promiseRes
        })
      } else {
        return raw(string)
      }
    },
  }
}

export const useContext = <T>(context: Context<T>): T => {
  return context.values[context.values.length - 1]
}
