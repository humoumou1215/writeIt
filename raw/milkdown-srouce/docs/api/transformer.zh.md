# @milkdown/transformer

Transformer API 用于在编辑器的 ProseMirror 状态与 Markdown AST 之间进行相互转换。
在大多数情况下，你不需要直接使用这些 API。
只有在编写语法插件时，你才需要了解如何使用
[ParserState](#class-parserstate-extends-stack) 和 [SerializerState](#class-serializerstate-extends-stack)。

## 解析器

@ParserState

@Parser
@NodeParserSpec
@MarkParserSpec

## 序列化器

@SerializerState

@Serializer
@NodeSerializerSpec
@MarkSerializerSpec

---

## 模式

@NodeSchema
@MarkSchema

## 工具类型

@RemarkPlugin
@RemarkParser
@MarkdownNode

## 栈

@Stack
@StackElement
