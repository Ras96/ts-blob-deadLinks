import { main } from './main'

declare const global: {
  [x: string]: () => Promise<void>
}
global.main = main
