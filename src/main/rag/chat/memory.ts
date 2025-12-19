import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'
import { getSettings } from '../../settings'
import { createChatModel } from '../../utils/createChatModel'

export async function updateConversationMemory(
  prevMemory: string | null,
  question: string,
  answer: string
): Promise<string> {
  const settings = getSettings()
  const model = createChatModel(settings.provider)
  const template = `你是对话记忆压缩器。将已有会话记忆与本轮对话融合为新的会话记忆。
要求：
1) 只保留：用户目标/偏好、已确认事实、重要约束、关键结论/决定、待办事项。
2) 删除无关细节、客套话、重复内容。
3) 输出中文，尽量精炼，不超过200字。
4) 只输出记忆文本，不要加标题、列表符号或其它说明。

已有会话记忆：
{memory}

本轮用户问题：
{question}

本轮助手回答：
{answer}

新的会话记忆：`

  const prompt = PromptTemplate.fromTemplate(template)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])
  const next = await chain.invoke({
    memory: (prevMemory || '').slice(0, 800),
    question: question.slice(0, 800),
    answer: answer.slice(0, 1200)
  })
  return next.trim().slice(0, 400)
}
