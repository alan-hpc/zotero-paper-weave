import assert from 'node:assert/strict';

export async function verifySvgCurves(moduleFor){
  const {cubicSvgPath}=await moduleFor('src/svgPath.ts');
  const {latexBox,drawLatex}=await moduleFor('src/latex.ts');
  assert.equal(cubicSvgPath('M0 0Q3 6 6 0T12 0'),'M0 0 C2 4 4 4 6 0 C8 -4 10 -4 12 0');
  assert.equal(cubicSvgPath('m0 0q3 6 6 0t6 0'),'M0 0 C2 4 4 4 6 0 C8 -4 10 -4 12 0');
  assert.equal(cubicSvgPath('M0 0Q3 6 6 0L6 2T12 2'),'M0 0 C2 4 4 4 6 0 L6 2 C6 2 8 2 12 2');
  assert.equal(cubicSvgPath('M0 0C1 2 3 4 5 6S9 10 11 12'),'M0 0 C1 2 3 4 5 6 C7 8 9 10 11 12');
  assert.equal(cubicSvgPath('M0 0Q3 6 6 0S9 10 11 12'),'M0 0 C2 4 4 4 6 0 C6 0 9 10 11 12');
  assert.equal(cubicSvgPath('M1 2h3v4h-3z m1 1 2 2'),'M1 2 L4 2 L4 6 L1 6 Z M2 3 L4 5');
  assert.equal(cubicSvgPath('M+1e1 -.5L.25 2e+1'),'M10 -0.5 L0.25 20');
  for(const invalid of ['M0 0Q1 2 3','M0 0?L1 2','M0 0A1 1 0 0 0 2 2','MNaN 0',''])assert.throws(()=>cubicSvgPath(invalid),/LaTeX/u);
  // An exact quadratic-to-cubic conversion agrees over the complete curve,
  // rather than merely joining the same endpoints with a different outline.
  const quadratic=t=>[6*t,12*t*(1-t)];
  for(let i=0;i<=100;i++){
    const t=i/100,u=1-t,cubic=[3*u*u*t*2+3*u*t*t*4+t*t*t*6,3*u*u*t*4+3*u*t*t*4];
    assert.ok(cubic.every((n,j)=>Math.abs(n-quadratic(t)[j])<1e-10));
  }
  for(const tex of [String.raw`(e,r)`,String.raw`m^s(e,r)`,String.raw`rem^E(e,r)=r`,String.raw`\Gamma_r^{DP}=\{(e,r)\mid e\in[0,E)\}`,
    String.raw`\left(\frac{x}{y}\right)`,String.raw`\begin{pmatrix}a&b\\c&d\end{pmatrix}`,String.raw`\sqrt{x^2+y^2}`,String.raw`\sum_{i=0}^{N}e^{x_i}`,
    String.raw`\log(x)`,String.raw`\sin(x)+\cos(x)+\exp(y)`,
    String.raw`\mathit{without\ any\ adaptation}`,String.raw`(\log_2(n)\text{ vs. }\log_2(d))`,
    String.raw`\ell_m(\mathbf{x}) = g_m(\mathbf{x}) - g_{\mathrm{pub},m}(\mathbf{x}) = \log(\alpha_m/\alpha_{\mathrm{pub}})`]){
    const box=latexBox(tex);assert.ok(box.shapes.length);assert.ok(box.width>0&&box.ascent+box.descent>0);
    const paths=[];
    drawLatex({pushOperators(){},drawSvgPath(path){paths.push(path);}},tex,10,20,12,{type:'RGB',red:0,green:0,blue:0});
    assert.equal(paths.length,box.shapes.length);
    assert.ok(paths.every(p=>!/[QqTtSs]/u.test(p)),'all smooth/quadratic glyph curves reach PDF as explicit cubic paths');
  }
  assert.throws(()=>latexBox(''),/为空/);assert.throws(()=>latexBox('\u2061'),/图形尺寸/,'an all-invisible formula cannot masquerade as a rendered expression');
  assert.throws(()=>latexBox(String.raw`\text{ }`),/图形尺寸/,'space alone is not a rendered expression');
  assert.ok(latexBox(String.raw`a\ b`).width>latexBox('ab').width,'invisible space advance remains in formula metrics');
  console.log('PASS mathematical glyph outlines: exact curves, strict malformed paths, parentheses/fractions/matrices, invisible function operators, log/sin/cos/exp and DistMoE routing log odds');
}
