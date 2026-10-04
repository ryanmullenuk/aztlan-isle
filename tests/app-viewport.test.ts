import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stripOverscan, viewportSize } from '../src/render/AppViewport';

test('iPhone controls stay inside the available portrait and landscape area', () => {
  assert.deepEqual(viewportSize(393, 759), [393, 759]);
  assert.deepEqual(viewportSize(852, 360), [852, 360]);
});
test('visible viewport constrains controls when iOS reduces the drawable area', () => {
  assert.deepEqual(viewportSize(393, 852, 393, 759), [393, 759]);
  assert.deepEqual(viewportSize(852, 393, 852, 360), [852, 360]);
});
test('full screen and split screen retain their actual available dimensions', () => {
  assert.deepEqual(viewportSize(393, 852, 393, 852), [393, 852]);
  assert.deepEqual(viewportSize(600, 900), [600, 900]);
});

test('an iOS home-screen app overscans the game into the status-bar strip, and nothing else does', () => {
  // iPhone 15 Pro Max as a home-screen app on iOS 26: the page is 59pt short of the 932pt screen.
  assert.equal(stripOverscan(true, true, 430, 873, 430, 932), 59);
  // Already full height (older iOS, or the status bar overlaid properly): nothing to fill.
  assert.equal(stripOverscan(true, true, 430, 932, 430, 932), 0);
  // Landscape: the screen is still reported in portrait.
  assert.equal(stripOverscan(true, true, 932, 430, 430, 932), 0);
  assert.equal(stripOverscan(true, true, 932, 400, 430, 932), 30);
  // A Safari tab has its own toolbars (a big gap that isn't a strip), and other devices never overscan.
  assert.equal(stripOverscan(true, false, 430, 873, 430, 932), 0);
  assert.equal(stripOverscan(true, true, 430, 740, 430, 932), 0);
  assert.equal(stripOverscan(false, true, 412, 860, 412, 915), 0);
});
