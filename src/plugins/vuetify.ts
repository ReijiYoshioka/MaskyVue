import { createVuetify } from 'vuetify'

// トークン値は ../../DESIGN.md の colors / rounded / components に準拠。
export default createVuetify({
  theme: {
    defaultTheme: 'maskyLight',
    themes: {
      maskyLight: {
        dark: false,
        colors: {
          primary: '#007BA7',
          secondary: '#52606D',
          background: '#F7F9FC',
          surface: '#FFFFFF',
          success: '#2F7D4A',
          warning: '#FFF3B8',
          error: '#C44747',
          info: '#007BA7',
        },
      },
    },
  },
  defaults: {
    VCard: {
      // rounded.lg(24px) 相当。DESIGN.md「Elevation & Depth」: elevation は使わず独自 shadow で表現。
      elevation: 0,
      rounded: 'xl',
    },
    VChip: {
      rounded: 'pill',
    },
  },
})
