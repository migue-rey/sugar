// Compose a temporary export surface so the brand stays outside the zoomed viewport.
// The live diagram and its persisted data are never modified.
export function createExportFrame(element: HTMLElement) {
  const { width, height } = element.getBoundingClientRect()
  const frame = document.createElement('div')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, {
    position: 'fixed', left: '-100000px', top: '0',
    width: `${width}px`, height: `${height}px`, overflow: 'hidden', pointerEvents: 'none',
  })
  const diagram = element.cloneNode(true) as HTMLElement
  Object.assign(diagram.style, { width: '100%', height: '100%' })
  frame.append(diagram)

  const brand = document.createElement('div')
  brand.dataset.exportWatermark = 'sugar'
  Object.assign(brand.style, {
    position: 'absolute', right: '16px', bottom: '16px', zIndex: '10000',
    display: 'flex', alignItems: 'center', gap: '7px', opacity: '0.72',
    color: getComputedStyle(element).getPropertyValue('--text').trim() || '#28241f',
    fontFamily: '"Space Grotesk", sans-serif', fontSize: '17px',
    fontWeight: '700', lineHeight: '24px', whiteSpace: 'nowrap',
  })
  const logo = document.createElement('img')
  logo.src = '/sugar-mark.png'
  logo.alt = ''
  logo.width = 24
  logo.height = 24
  Object.assign(logo.style, { display: 'block', width: '24px', height: '24px', objectFit: 'contain' })
  const name = document.createElement('span')
  name.textContent = 'Sugar'
  brand.append(logo, name)
  frame.append(brand)
  // Retain the canvas's theme variables and stylesheet context during serialization.
  element.parentElement!.append(frame)
  return frame
}
