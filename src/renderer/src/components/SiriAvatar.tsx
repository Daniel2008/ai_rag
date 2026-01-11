import type { CSSProperties, ReactElement } from 'react'
import { theme as antdTheme } from 'antd'

export type SiriAvatarPhase = 'idle' | 'thinking' | 'answering' | 'processing' | 'error'

interface SiriAvatarProps {
    phase: SiriAvatarPhase
    size?: 'small' | 'medium' | 'large'
    className?: string
    style?: CSSProperties
}

const sizeMap = {
    small: 56,
    medium: 80,
    large: 110
}

/**
 * 类Siri风格的AI虚拟形象组件
 * 使用多彩光线波形效果 - 类似Apple Siri的动态光带
 */
export function SiriAvatar({
    phase,
    size = 'medium',
    className = '',
    style
}: SiriAvatarProps): ReactElement {
    const { token } = antdTheme.useToken()
    const dimension = sizeMap[size]

    return (
        <div
            className={`siri-wave siri-wave--${phase} siri-wave--${size} ${className}`}
            style={{
                '--siri-size': `${dimension}px`,
                '--siri-primary': token.colorPrimary,
                ...style
            } as CSSProperties}
        >
            {/* 背景光晕 */}
            <div className="siri-wave__glow" />

            {/* 多彩光线条 - 5条不同颜色的动态光带 */}
            <div className="siri-wave__lines">
                <span className="siri-wave__line siri-wave__line--1" />
                <span className="siri-wave__line siri-wave__line--2" />
                <span className="siri-wave__line siri-wave__line--3" />
                <span className="siri-wave__line siri-wave__line--4" />
                <span className="siri-wave__line siri-wave__line--5" />
            </div>

            {/* 中心光点 */}
            <div className="siri-wave__core" />

            {/* 漂浮粒子 */}
            <div className="siri-wave__particles">
                <span className="siri-wave__particle" />
                <span className="siri-wave__particle" />
                <span className="siri-wave__particle" />
                <span className="siri-wave__particle" />
            </div>
        </div>
    )
}

export default SiriAvatar
