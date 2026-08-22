import {describe, expect, test} from 'vitest';
import {ProgramConfiguration} from './program_configuration';
import {FeaturePositionMap} from './feature_position_map';
import {createStyleLayer} from '../style/create_style_layer';
import {EvaluationParameters} from '../style/evaluation_parameters';
import type {LineStyleLayer} from '../style/style_layer/line_style_layer';
import type {Feature} from '@maplibre/maplibre-gl-style-spec';

function lineLayerWith(lineOpacity: unknown): LineStyleLayer {
    const layer = createStyleLayer({
        id: 'road',
        type: 'line',
        source: 'basemap',
        'source-layer': 'transportation',
        paint: {'line-opacity': lineOpacity}
    } as any, {}) as LineStyleLayer;
    layer.recalculate(new EvaluationParameters(0), []);
    return layer;
}

describe('ProgramConfiguration.updatePaintArrays', () => {
    const feature = {properties: {}, type: 2 as const, id: 1} as any as Feature;
    const vtLayer = {feature: () => feature} as any;
    const options = {imagePositions: {}, dashPositions: {}};

    function featureMapOf(id: number) {
        const featureMap = new FeaturePositionMap();
        featureMap.add(id, 0, 0, 1);
        featureMap.indexed = true;
        return featureMap;
    }

    test('applies feature state to a state-dependent property', () => {
        const layer = lineLayerWith(['case', ['!=', ['feature-state', 'ride'], null], 1, 0]);
        const config = new ProgramConfiguration(layer, 0, () => true);
        config.populatePaintArrays(1, feature, options);

        const dirty = config.updatePaintArrays({1: {ride: true}}, featureMapOf(1), vtLayer, layer, options);

        expect(dirty).toBe(true);
    });

    test('skips a property the layer turned constant since the tile was parsed', () => {
        // The buffers are built for the state-dependent expression, then the live
        // layer is restyled to a constant — the case a style change mid-parse
        // leaves behind. The constant carries no `evaluate`, so reading it would
        // throw and abandon the rest of the tile's feature state.
        const parsedWith = lineLayerWith(['case', ['!=', ['feature-state', 'ride'], null], 1, 0]);
        const config = new ProgramConfiguration(parsedWith, 0, () => true);
        config.populatePaintArrays(1, feature, options);
        const restyled = lineLayerWith(0.5);

        const dirty = config.updatePaintArrays({1: {ride: true}}, featureMapOf(1), vtLayer, restyled, options);

        expect(dirty).toBe(false);
    });
});
