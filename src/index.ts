import { Main } from './main'

// declare const global: {
//   [x: string]: () => Promise<void>
// }
// global.main = main

declare const global: {
  [x: string]: () => void
}

global.trigger = () => {
  const trigger = new Main()
  trigger.main()
}
