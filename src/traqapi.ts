import * as path from 'path'
import * as fs from 'fs-extra'
import FormData from 'form-data'
import fetch from 'node-fetch'
const token = process.env.TRAQ_ACCESS_TOKEN
const postChannnelId = process.env.TRAQ_POST_CHANNEL

if (token === undefined) {
  throw new Error('Access token should not be empty.')
}
if (postChannnelId === undefined) {
  throw new Error('channelId should not be empty.')
}

const postMessage = async (message: string) => {
  const url = `https://q.trap.jp/api/v3/channels/${postChannnelId}/messages`
  const body = {
    content: message,
    embed: true
  }
  await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })
}

export { postMessage }

const postFile = async () => {
  const file = fs.readFileSync(path.join(__dirname, '../deadLinks.json'))
  const form = new FormData()
  const url = 'https://q.trap.jp/api/v3/files'
  const now = new Date()
  const year = now.getFullYear()
  const month = ('00' + (now.getMonth() + 1)).slice(-2)
  const date = ('00' + now.getDate()).slice(-2)
  form.append('channelId', postChannnelId)
  form.append('file', file, {
    filename: `deadLinks_${year}${month}${date}.json`,
    contentType: 'application/json',
    knownLength: file.length
  })
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`
    },
    body: form
  })
  const { id } = await response.json()
  postMessage(`https://q.trap.jp/files/${id}`)
}
export { postFile }
