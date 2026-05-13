/**
 * ASCII artwork constants for the onboarding flow.
 *
 * Two static strings rendered into the left column of the onboarding shell.
 * Kept as plain template literals (no runtime composition) so they can be
 * inlined into a <pre> verbatim and snapshot-pinned by tests.
 */

export const SUNFLOWER_ASCII = `              .**oOo**.
           .*oO@@@@@@@Oo*.
          *oO@@@@8@8@@@@Oo*
         *O@@@@8@@O@@8@@@@O*
        oO@@@8@O*****O8@@@Oo
       *O@@@8@O*::o::*O@8@@O*
       oO@@@@O*:o888o:*O@@@@o
       oO@@@@O::o8@8o::O@@@@o
       *O@@@8@O*:ooo:*O@8@@O*
        oO@@@8@O*****O8@@@Oo
         *O@@@@8@@O@@8@@@@O*
          *oO@@@@8@8@@@@Oo*
           .*oO@@@@@@@Oo*.
              \\**oOo**/
                 |||
                 |||
              <__|||__>
                 |||
              <__|||__>
                 |||
                 |||
                 |||
       _________|||_________
      _____________________
`;

export const WORDMARK_ASCII = `   _____  _                       _
  / ____|| |                     | |
 | |     | |__     __ _   _ __   | |  ___   ___
 | |     | '_ \\   / _\` | | '__|  | | / _ \\ / __|
 | |____ | | | | | (_| | | |     | ||  __/ \\__ \\
  \\_____||_| |_|  \\__,_| |_|     |_| \\___| |___/
`;
