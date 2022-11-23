import { sendNotification } from './notification'
import { getAuthToken, PubSubData } from './index'
import axios from 'axios'
import { parse, SearchParserKeyWordOffset } from 'search-query-parser'
import { addLabels } from './label'
import { archivePage, markPageAsRead } from './page'

export enum RuleActionType {
  AddLabel = 'ADD_LABEL',
  Archive = 'ARCHIVE',
  MarkAsRead = 'MARK_AS_READ',
  SendNotification = 'SEND_NOTIFICATION',
}

export interface RuleAction {
  type: RuleActionType
  params: string[]
}

export interface Rule {
  id: string
  userId: string
  name: string
  filter: string
  actions: RuleAction[]
  description?: string
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

interface SearchFilter {
  subscriptionFilter?: string
}

const parseSearchFilter = (filter: string): SearchFilter => {
  const searchFilter = filter ? filter.replace(/\W\s":/g, '') : undefined
  const result: SearchFilter = {}

  if (!searchFilter || searchFilter === '*') {
    return result
  }

  const parsed = parse(searchFilter, {
    keywords: ['subscription'],
    tokenize: true,
  })
  if (parsed.offsets) {
    const keywords = parsed.offsets
      .filter((offset) => 'keyword' in offset)
      .map((offset) => offset as SearchParserKeyWordOffset)

    for (const keyword of keywords) {
      switch (keyword.keyword) {
        case 'subscription':
          result.subscriptionFilter = keyword.value
      }
    }
  }

  return result
}

const isValidData = (filter: string, data: PubSubData): boolean => {
  const searchFilter = parseSearchFilter(filter)

  if (searchFilter.subscriptionFilter) {
    return isValidSubscription(searchFilter.subscriptionFilter, data)
  }

  return true
}

const isValidSubscription = (
  subscriptionFilter: string,
  data: PubSubData
): boolean => {
  if (!data.subscription) {
    return false
  }

  return subscriptionFilter === '*' || data.subscription === subscriptionFilter
}

export const getEnabledRules = async (
  userId: string,
  apiEndpoint: string,
  jwtSecret: string
): Promise<Rule[]> => {
  const auth = await getAuthToken(userId, jwtSecret)

  const data = JSON.stringify({
    query: `query {
      rules(enabled: true) {
        ... on RulesError {
          errorCodes
        }
        ... on RulesSuccess {
          rules {
            id
            name
            filter
            actions {
              type
              params
            }
          }  
        }
      }
    }`,
  })

  const response = await axios.post(`${apiEndpoint}/graphql`, data, {
    headers: {
      Cookie: `auth=${auth};`,
      'Content-Type': 'application/json',
    },
  })

  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
  return response.data.data.rules.rules as Rule[]
}

export const triggerActions = async (
  userId: string,
  rules: Rule[],
  data: PubSubData,
  apiEndpoint: string,
  jwtSecret: string
) => {
  for (const rule of rules) {
    if (!isValidData(rule.filter, data)) {
      continue
    }

    const authToken = await getAuthToken(userId, jwtSecret)

    for (const action of rule.actions) {
      switch (action.type) {
        case RuleActionType.AddLabel:
          if (!data.id || action.params.length === 0) {
            console.log('invalid data for add label action')
            continue
          }
          await addLabels(apiEndpoint, authToken, data.id, action.params)
          break
        case RuleActionType.Archive:
          if (!data.id) {
            console.log('invalid data for archive action')
            continue
          }
          await archivePage(apiEndpoint, authToken, data.id)
          break
        case RuleActionType.MarkAsRead:
          if (!data.id) {
            console.log('invalid data for mark as read action')
            continue
          }
          await markPageAsRead(apiEndpoint, authToken, data.id)
          break
        case RuleActionType.SendNotification:
          for (const message of action.params) {
            await sendNotification(apiEndpoint, authToken, message)
          }
          break
      }
    }
  }
}
