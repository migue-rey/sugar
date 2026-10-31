import { CubeIcon, PowerIcon, Battery100Icon, CpuChipIcon, SignalIcon, FireIcon, GlobeAltIcon, WifiIcon, ComputerDesktopIcon, CircleStackIcon, Cog6ToothIcon, SpeakerWaveIcon, LightBulbIcon, LinkIcon, ClockIcon, ShieldCheckIcon } from '@heroicons/vue/24/outline'
import type { Block } from './types'
export const categorySymbols = { cube: CubeIcon, power: PowerIcon, battery: Battery100Icon, cpu: CpuChipIcon, sensor: SignalIcon, temperature: FireIcon, network: GlobeAltIcon, radio: WifiIcon, display: ComputerDesktopIcon, storage: CircleStackIcon, motor: Cog6ToothIcon, audio: SpeakerWaveIcon, light: LightBulbIcon, connector: LinkIcon, clock: ClockIcon, shield: ShieldCheckIcon }
export type CategoryIconKey = keyof typeof categorySymbols
export type CategoryIconMap = Record<string, CategoryIconKey | null>
export const iconNames: Record<'es' | 'en', Record<CategoryIconKey, string>> = {
  es: { cube: 'Genérico', power: 'Alimentación', battery: 'Batería', cpu: 'Controlador', sensor: 'Sensor', temperature: 'Temperatura', network: 'Red', radio: 'Radio', display: 'Pantalla', storage: 'Almacenamiento', motor: 'Motor', audio: 'Audio', light: 'Iluminación', connector: 'Conector', clock: 'Reloj', shield: 'Protección' },
  en: { cube: 'Generic', power: 'Power', battery: 'Battery', cpu: 'Controller', sensor: 'Sensor', temperature: 'Temperature', network: 'Network', radio: 'Radio', display: 'Display', storage: 'Storage', motor: 'Motor', audio: 'Audio', light: 'Lighting', connector: 'Connector', clock: 'Clock', shield: 'Protection' }
}
export function resolveCategoryIcon(block: Pick<Block,'category' | 'subcategory'>, icons: CategoryIconMap): CategoryIconKey { return (block.subcategory && icons[block.subcategory]) || (block.category && icons[block.category]) || 'cube' }
export function blockImage(block: Pick<Block, 'image'>) { const url = block.image; return typeof url === 'string' && (url.startsWith('https://') || /^\/api\/images\/[0-9a-f-]{36}\/content$/.test(url)) ? url : '' }
