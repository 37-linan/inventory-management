# 生成「图片查看（多张）」效果预览页
# 用系统里真实的两张照片（缩到 520px 宽 + base64 内嵌），页面自包含、不依赖外部文件
from PIL import Image
import base64, io, os

d = r'F:/出入库管理系统/uploads/2026-07-27'
out = r'F:/出入库管理系统/.workbuddy/tmp/preview-multi-image.html'
files = sorted(os.listdir(d))[:2]

imgs = []
for f in files:
    im = Image.open(os.path.join(d, f)).convert('RGB')
    im.thumbnail((520, 520), Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, 'JPEG', quality=72)
    imgs.append(base64.b64encode(buf.getvalue()).decode())

one_box = lambda src, i, n: f'''
      <div style="{'margin-top:16px;padding-top:16px;border-top:1px dashed #e0e0e0;' if i else ''}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <span style="font-size:12px;color:#5f6368;">第 {i+1} / {n} 张</span>
          <button style="padding:4px 10px;font-size:12px;border:none;border-radius:6px;background:#f0f0f0;color:#202124;cursor:pointer;">💾 保存图片</button>
        </div>
        <img src="data:image/jpeg;base64,{src}" style="max-width:100%;max-height:58vh;border-radius:8px;" />
      </div>'''

html = f'''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>图片查看（多张）效果预览</title>
<style>
  body {{ background:#0f1115; color:#e6e6e6; margin:0; padding:24px 16px; font-family:system-ui,-apple-system,"Microsoft YaHei",sans-serif; }}
  h1 {{ font-size:16px; font-weight:600; margin:0 0 6px; }}
  p.tip {{ font-size:13px; color:#9aa0a6; line-height:1.75; margin:0 0 20px; }}
  .row {{ display:flex; gap:26px; flex-wrap:wrap; align-items:flex-start; }}
  .label {{ font-size:13px; margin-bottom:8px; }}
  .label.bad {{ color:#ff8a80; }} .label.good {{ color:#81c995; }}
  .modal {{ width:380px; background:#fff; color:#202124; border-radius:12px; overflow:hidden; box-shadow:0 8px 30px rgba(0,0,0,.5); }}
  .modal-head {{ padding:14px 16px; font-size:15px; font-weight:600; border-bottom:1px solid #e0e0e0; display:flex; justify-content:space-between; align-items:center; }}
  .modal-head span.x {{ color:#9aa0a6; font-size:18px; }}
  .modal-body {{ padding:16px; text-align:center; max-height:76vh; overflow-y:auto; }}
  table {{ border-collapse:collapse; font-size:12px; }}
  td {{ padding:3px 6px; }}
  .lk {{ color:#1a73e8; text-decoration:none; white-space:nowrap; }}
</style></head>
<body>
  <h1>「图片查看」改版效果（入库/出库一次拍多张）</h1>
  <p class="tip">左边是改动前——拍了两张，点开只看到第一张；右边是改动后——两张都在，能上下翻着看，
  每张右上角都有独立的「保存图片」，保存出来的文件名带「第1张 / 第2张」不会互相覆盖。</p>
  <div class="row">
    <div class="col">
      <div class="label bad">✕ 改动前</div>
      <div class="modal">
        <div class="modal-head">图片预览 <span class="x">✕</span></div>
        <div class="modal-body">
          <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
            <button style="padding:4px 10px;font-size:12px;border:none;border-radius:6px;background:#f0f0f0;color:#202124;">💾 保存图片</button>
          </div>
          <img src="data:image/jpeg;base64,{imgs[0]}" style="max-width:100%;max-height:58vh;border-radius:8px;" />
        </div>
      </div>
    </div>
    <div class="col">
      <div class="label good">✓ 改动后</div>
      <div class="modal">
        <div class="modal-head">图片预览（共 2 张） <span class="x">✕</span></div>
        <div class="modal-body">
          {one_box(imgs[0], 0, 2)}
          {one_box(imgs[1], 1, 2)}
        </div>
      </div>
    </div>
    <div class="col">
      <div class="label">记录表里长这样</div>
      <div class="modal" style="width:340px;">
        <div class="modal-body" style="text-align:left;">
          <table>
            <tr><td style="color:#5f6368;">商品</td><td>例子A</td><td style="color:#5f6368;">图片</td><td><a class="lk" href="#">图片查看(2)</a></td></tr>
            <tr><td style="color:#5f6368;">商品</td><td>例子B</td><td style="color:#5f6368;">图片</td><td><a class="lk" href="#">图片查看</a></td></tr>
            <tr><td style="color:#5f6368;">商品</td><td>例子C</td><td style="color:#5f6368;">图片</td><td style="color:#9aa0a6;">-</td></tr>
          </table>
          <p style="font-size:11px;color:#9aa0a6;margin:10px 0 0;">一张显示「图片查看」，多张显示「图片查看(N)」，没拍显示「-」</p>
        </div>
      </div>
    </div>
  </div>
</body></html>'''

with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print('写出', out, os.path.getsize(out) // 1024, 'KB')
